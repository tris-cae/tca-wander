-- ─── Place ids are client-generated strings, not uuids ───────────────────────
--
-- Sign-in worked, backup did not. The app reported "Could not back up" and the
-- server stayed empty. The cause:
--
--     invalid input syntax for type uuid: "m3k2j1a9xq7bz"
--
-- Until 2026-10-06 (commit f5d5b34) the app generated place ids like this:
--
--     Date.now().toString(36) + Math.random().toString(36).slice(2)
--
-- Every place saved before that date carries an id of that shape. The column
-- here was declared `uuid`, so Postgres rejected those rows outright.
--
-- It failed in the worst possible way. The sync engine uploads up to 100 rows
-- in ONE upsert, so a single pre-October place poisoned the entire batch and
-- nothing synced at all — not even the places with valid uuids. A user with one
-- old place and two hundred new ones would back up precisely nothing, and the
-- only symptom is a message saying it will try again, which it does, forever.
--
-- ── Why widen the column instead of rewriting the ids on the device ──
--
-- The alternative was a local migration rewriting every legacy id to a uuid,
-- updating places, trip_places, day_places, notification_log and the sync
-- outbox together. That was rejected for three reasons:
--
--   1. Those ids are the only copy of the user's data. It lives on one phone
--      and is not backed up anywhere — that is the very problem being fixed
--      here. Rewriting primary keys on irreplaceable data to satisfy a type
--      constraint is the wrong order of operations.
--   2. It needs a new TestFlight build to reach anyone. Widening the column
--      fixes the app already installed on their phone, with no release.
--   3. In an offline-first app the client generates the ids and is the source
--      of truth for them. `uuid` bought validation against a value the server
--      never produces, and the cost of that validation was total sync failure.
--
-- This is safe to do now precisely because it is early: places, lists and
-- list_places are all empty, so nothing is being converted. The same change
-- once real rows exist would be a far bigger deal.
--
-- New places still get `Crypto.randomUUID()`. Nothing about this encourages
-- non-uuid ids; it stops the server rejecting the ones that already exist.

-- Postgres refuses to alter a column that a policy expression mentions, so
-- places_select has to come off and go back on unchanged. It is recreated
-- verbatim below — if you are editing that policy, edit it in its own
-- migration, not here, so this one stays a pure type change.
drop policy places_select on public.places;

-- The foreign key has to come off before either column can change type, and
-- both must change: a text column cannot reference a uuid one.
alter table public.list_places
  drop constraint list_places_place_id_fkey;

alter table public.places
  alter column id type text using id::text;

alter table public.list_places
  alter column place_id type text using place_id::text;

alter table public.list_places
  add constraint list_places_place_id_fkey
  foreign key (place_id) references public.places(id) on delete cascade;

-- Put places_select back exactly as it was: your own places, plus any place
-- sitting in a list you are allowed to view.
create policy places_select on public.places
  for select
  using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.list_places lp
      where lp.place_id = places.id
        and lp.deleted_at is null
        and can_view_list(lp.list_id)
    )
  );

-- Reject the empty string, which `uuid` previously made impossible. Everything
-- else a client might generate is allowed on purpose.
alter table public.places
  add constraint places_id_not_blank check (length(trim(id)) > 0);
