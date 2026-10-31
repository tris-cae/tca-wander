// ─── When sync runs ───────────────────────────────────────────────────────────
//
// lib/sync.ts decides what syncing does. This decides when, and keeps a little
// state for the one line of status the Profile screen shows.
//
// Three moments, chosen because each is one where the phone is both awake and
// likely to have something to exchange:
//
//   · signing in — the first upload of everything saved before there was an
//     account, and the first download onto a new phone
//   · returning to the app — picks up anything another device did meanwhile
//   · saving a place — so a new place is backed up in seconds, not whenever
//     the app next happens to be reopened
//
// There is no timer. A background poll would spend battery on the overwhelming
// majority of occasions when nothing has changed, and the proximity alerts are
// already the thing this app asks the battery for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from './auth';
import { placeSavedEvent } from './places-event';
import { pendingCount, syncNow, type SyncResult } from './sync';

export interface SyncStatus {
  /** A sync is in flight. */
  syncing: boolean;
  /** Local changes not yet on the server. */
  pending: number;
  /** Message from the last failure, cleared by the next success. */
  error: string | null;
  /** When the last successful sync finished. */
  lastSyncedAt: Date | null;
  /** Run one now. Used by the "Back up now" row. */
  sync(): void;
}

export function useSync(): SyncStatus {
  const { session } = useAuth();

  const [syncing,      setSyncing]      = useState(false);
  const [pending,      setPending]      = useState(0);
  const [error,        setError]        = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Lets the effects below call the latest run() without re-subscribing their
  // listeners every render.
  const runRef = useRef<() => void>(() => {});

  const run = useCallback(() => {
    if (!session) return;
    setSyncing(true);
    syncNow()
      .then((result: SyncResult) => {
        // A skipped run carries no information — its counts are all zero
        // because nothing happened, not because nothing is pending. Reading
        // them would blank the status line every time a pull re-triggers us.
        if (result.skipped) return;
        setPending(result.remaining);
        setError(result.error ?? null);
        if (!result.error) setLastSyncedAt(new Date());
      })
      .catch((err) => setError(err?.message ?? 'Sync failed'))
      .finally(() => setSyncing(false));
  }, [session]);

  runRef.current = run;

  // Signing in, and signing out. Both change what the status line should say.
  useEffect(() => {
    if (!session) {
      setPending(0);
      setError(null);
      setLastSyncedAt(null);
      return;
    }
    run();
  }, [session, run]);

  // Coming back to the app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runRef.current();
    });
    return () => sub.remove();
  }, []);

  // A place was saved, imported, edited or deleted.
  useEffect(() => placeSavedEvent.subscribe(() => runRef.current()), []);

  // Keep the pending count honest even when nothing triggers a run — a failed
  // push leaves items queued, and the screen should say so.
  useEffect(() => {
    if (!session) return;
    pendingCount().then(setPending).catch(() => {});
  }, [session, syncing]);

  return { syncing, pending, error, lastSyncedAt, sync: run };
}
