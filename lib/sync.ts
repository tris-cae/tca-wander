// ─── Sync ─────────────────────────────────────────────────────────────────────
//
// Keeps the phone's places and the server's copy in step.
//
// The shape of it, as agreed: the server is the source of truth, and the phone
// keeps a complete local copy that it can work from with no connection at all.
// Nothing here is required for the app to function — someone who never signs in
// has exactly the app they had before.
//
// Four rules this file exists to keep:
//
//   1. Every change carries the time it happened ON THE PHONE, and the server
//      keeps whichever version is newer. The server half of that rule is the
//      trigger in supabase/migrations/0005_reject_stale_writes.sql.
//
//   2. The local copy is complete and is never trimmed to save space. It is a
//      replica, not a cache — if it were a cache, a user on a plane with a cold
//      app would open it to an empty list.
//
//   3. A change and its outbox entry are written in the same transaction. That
//      is enforced by SQLite triggers in lib/db.ts rather than by remembering
//      to call something.
//
//   4. Never pull while there is anything waiting to be pushed. Doing so would
//      let the server's older copy overwrite a local edit that has not been
//      sent yet, which looks exactly like the app discarding someone's work.
//
// Sync runs only in the foreground. The background location task must never
// import this file — see the note at the top of lib/supabase.ts.

import type { PlaceForSync } from './db';
import {
  applyRemotePlaces,
  clearOutboxEntries,
  countOutbox,
  getOutbox,
  getPlacesForSync,
  getSyncMeta,
  queueAllPlacesForSync,
  recordOutboxFailure,
  setSyncMeta,
} from './db';
import { placeSavedEvent } from './places-event';
import { supabase } from './supabase';

/** How far the last successful pull reached. */
const K_PULLED_THROUGH = 'pulledThrough';
/** Which account this phone's sync bookkeeping belongs to. */
const K_SYNC_USER = 'syncUserId';
/** Set once the one-off upload of pre-account places has been queued. */
const K_SEEDED_FOR = 'seededForUser';

/**
 * Re-fetch a slice of time either side of the watermark.
 *
 * Two devices can write in the same second. Asking only for changes strictly
 * newer than the last one seen would let the second of them fall through the
 * gap and never be fetched again. Overlapping by a second means occasionally
 * re-fetching a row that is already current, which costs nothing: applying it
 * writes the same values back.
 */
const OVERLAP_MS = 1000;

/** How many places to send in one request. */
const BATCH = 100;

/** Only one sync at a time. A second call while one is running is a no-op. */
let running = false;

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Still waiting to go up — non-zero means the push did not fully drain. */
  remaining: number;
  error?: string;
  /**
   * Nothing ran: either signed out, or a sync was already in flight.
   *
   * Callers must not read the counts when this is set. They are all zero, and a
   * caller that treated that as fact would report "everything is backed up" at
   * the exact moment a sync is busy proving otherwise. This matters because a
   * pull emits placeSavedEvent, which triggers another syncNow() while the
   * first is still running — that second call lands here every time.
   */
  skipped?: boolean;
}

// ─── Shape translation ────────────────────────────────────────────────────────
//
// The phone writes camelCase and stores booleans as 0/1; Postgres uses
// snake_case and real booleans. Both halves of the translation live next to
// each other so a field cannot be added to one and forgotten in the other.

function toServer(p: PlaceForSync, ownerId: string) {
  return {
    id:              p.id,
    owner_id:        ownerId,
    name:            p.name,
    category:        p.category,
    lat:             p.lat,
    lng:             p.lng,
    address:         p.address,
    note:            p.note,
    source_url:      p.sourceUrl,
    source_type:     p.sourceType,
    visited:         p.visited === 1,
    google_place_id: p.placeId,
    saved_at:        p.savedAt,
    updated_at:      p.updatedAt ?? p.savedAt,
    deleted_at:      p.deletedAt,
  };
}

function toLocal(r: any): PlaceForSync {
  return {
    id:         r.id,
    name:       r.name,
    category:   r.category ?? '',
    lat:        r.lat,
    lng:        r.lng,
    address:    r.address,
    note:       r.note,
    sourceUrl:  r.source_url,
    sourceType: r.source_type,
    savedAt:    r.saved_at,
    updatedAt:  r.updated_at,
    deletedAt:  r.deleted_at,
    placeId:    r.google_place_id,
    visited:    r.visited ? 1 : 0,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Push local changes, then pull remote ones. Safe to call often — it returns
 * immediately if a sync is already in flight, and does nothing when signed out.
 */
export async function syncNow(): Promise<SyncResult> {
  const empty: SyncResult = { pushed: 0, pulled: 0, remaining: 0 };
  if (running) return { ...empty, skipped: true };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ...empty, skipped: true };
  const userId = session.user.id;

  running = true;
  try {
    await prepareForUser(userId);

    const pushed = await push(userId);
    const remaining = await countOutbox();

    // Rule 4. A pull now would hand back the server's older copy of whatever
    // is still queued and overwrite the local edit that has not gone up yet.
    const pulled = remaining === 0 ? await pull() : 0;

    return { pushed, pulled, remaining };
  } catch (err: any) {
    console.warn('[sync] run failed:', err?.message ?? err);
    return { ...empty, remaining: await countOutbox(), error: err?.message };
  } finally {
    running = false;
  }
}

/** True when there is anything waiting to go up. Drives the UI's status line. */
export async function pendingCount(): Promise<number> {
  return countOutbox();
}

// ─── Account changes ──────────────────────────────────────────────────────────

/**
 * Make sure the bookkeeping belongs to the account that is actually signed in.
 *
 * Two cases matter here.
 *
 * First sign-in: places saved before there was an account are queued for
 * upload, so signing up backs up what you already had instead of stranding it.
 *
 * A DIFFERENT account signing in on the same phone: the queue and the pull
 * watermark are cleared, and crucially the local places are NOT queued for the
 * new account. Uploading them would quietly copy one person's saved places into
 * someone else's account — the worst thing this file could do. The places stay
 * on the device, visible, because deleting someone's data on sign-in would be
 * the second worst.
 */
async function prepareForUser(userId: string): Promise<void> {
  const previous = await getSyncMeta(K_SYNC_USER);

  if (previous && previous !== userId) {
    console.log('[sync] a different account signed in — resetting sync state');
    const stale = await getOutbox(100000);
    await clearOutboxEntries(stale);
    await setSyncMeta(K_PULLED_THROUGH, null);
    await setSyncMeta(K_SYNC_USER, userId);
    // Deliberately NOT seeding this user with the previous user's places.
    await setSyncMeta(K_SEEDED_FOR, userId);
    return;
  }

  if (!previous) await setSyncMeta(K_SYNC_USER, userId);

  if (await getSyncMeta(K_SEEDED_FOR) !== userId) {
    const queued = await queueAllPlacesForSync();
    await setSyncMeta(K_SEEDED_FOR, userId);
    if (queued > 0) console.log(`[sync] queued ${queued} existing place(s) for first upload`);
  }
}

// ─── Push ─────────────────────────────────────────────────────────────────────

async function push(userId: string): Promise<number> {
  let sent = 0;

  // Re-read each pass rather than looping over one snapshot: a long push can
  // overlap with the user still editing, and the next pass should pick that up.
  for (;;) {
    const batch = (await getOutbox(BATCH)).filter((e) => e.entity === 'place');
    if (batch.length === 0) break;

    const rows = await getPlacesForSync(batch.map((e) => e.entityId));

    // A queued id with no row behind it can only mean the row was hard-deleted
    // out from under the queue. Nothing to send, and leaving it queued would
    // block every pull forever under rule 4, so drop it.
    const found = new Set(rows.map((r) => r.id));
    const orphans = batch.filter((e) => !found.has(e.entityId));
    if (orphans.length > 0) {
      console.warn(`[sync] dropping ${orphans.length} queued id(s) with no place row`);
      await clearOutboxEntries(orphans);
    }
    if (rows.length === 0) continue;

    const { error } = await supabase
      .from('places')
      .upsert(rows.map((r) => toServer(r, userId)), { onConflict: 'id' });

    if (error) {
      await recordOutboxFailure(batch, error.message);
      // Stop rather than move on. The next batch would almost certainly fail
      // the same way, and hammering a failing server helps nobody.
      throw new Error(error.message);
    }

    const uploaded = batch.filter((e) => found.has(e.entityId));
    await clearOutboxEntries(uploaded);
    sent += uploaded.length;

    // Everything that was queued when this pass started is now either sent or
    // re-queued by a concurrent edit. Either way the loop re-reads and decides.
    if (batch.length < BATCH) break;
  }

  return sent;
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pull(): Promise<number> {
  const since = (await getSyncMeta(K_PULLED_THROUGH)) ?? new Date(0).toISOString();

  const { data, error } = await supabase.rpc('changes_since', { since });
  if (error) throw new Error(error.message);

  const rows: any[] = Array.isArray(data) ? data : [];

  // changes_since also returns lists and list_places, which nothing consumes
  // yet. Ignored rather than failed on, so the server can start returning them
  // before the app knows what to do with them.
  const places = rows
    .filter((r) => r.table_name === 'places')
    .map((r) => toLocal(r.payload));

  if (places.length > 0) {
    await applyRemotePlaces(places);
    // Tell whichever screens are mounted to re-read. Without this a place that
    // arrived from another device sits in the database, correct and invisible,
    // until the user happens to switch tabs.
    placeSavedEvent.emit();
  }

  // The new watermark comes from the SERVER's timestamps, never from this
  // phone's clock. A phone whose clock is five minutes fast would otherwise
  // record a watermark in the future and never see those five minutes of other
  // people's changes again.
  const newest = places.reduce<string | null>(
    (max, p) => (!max || p.updatedAt! > max ? p.updatedAt! : max),
    null
  );

  if (newest) {
    const watermark = new Date(new Date(newest).getTime() - OVERLAP_MS).toISOString();
    await setSyncMeta(K_PULLED_THROUGH, watermark);
  }

  return places.length;
}
