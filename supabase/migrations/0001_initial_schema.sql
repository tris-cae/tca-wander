-- ─── Notice Explore — initial server schema ──────────────────────────────────
--
-- Checked into the repo and applied with the Supabase CLI rather than typed
-- into the dashboard, so the database can be rebuilt from source.
--
-- Two ideas run through all of this:
--
--   1. The phone is the source of new rows. Every id is a UUID generated on the
--      device, so a place created on a plane keeps the same identity when it
--      finally reaches the server. That is what makes re-sending safe: send the
--      same place twice and the second one is recognised, not duplicated.
--
--   2. Nothing is ever hard-deleted. A deleted row keeps its id and gets a
--      deleted_at timestamp, so other devices can learn that it went away. A
--      real DELETE leaves nothing behind to tell them.
--
-- Row Level Security is on for every table. The policies at the bottom are the
-- whole access-control story: a user sees their own rows, plus lists that have
-- been shared with them. There is no application code that can accidentally
-- bypass this — the database refuses.

-- ─── Extensions ───────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- ─── profiles ─────────────────────────────────────────────────────────────────
-- One row per account. Mirrors Supabase's own auth.users table, which we cannot
-- add columns to.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- Which sign-in method they last used on any device. Purely so the sign-in
  -- screen can put the right button first and reduce the chance of someone
  -- accidentally creating a second account with a different provider.
  last_provider text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Create the profile row automatically whenever a new account is created, so no
-- app code has to remember to do it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── places ───────────────────────────────────────────────────────────────────
-- Mirrors the phone's places table one-for-one so sync is a straight copy
-- rather than a translation.

create table public.places (
  -- Generated on the device, not here. Never use gen_random_uuid() as a default:
  -- the phone's id is the real identity and the server must preserve it.
  id         uuid primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,

  name       text not null,
  category   text not null default '',
  lat        double precision not null,
  lng        double precision not null,
  address    text,
  note       text,
  source_url text,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'maps', 'instagram')),
  visited    boolean not null default false,

  -- Google's permanent identifier. The one piece of Places data their terms
  -- allow keeping indefinitely.
  google_place_id text,

  -- When the Google-derived fields (name, address, lat, lng) were last
  -- refreshed. Unused today — Tristan decided on 2026-10-07 to defer the
  -- 30-day storage rule — but present so that work can be added later without
  -- restructuring the table or migrating anyone's data.
  details_refreshed_at timestamptz,

  saved_at   timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

-- Every sync query is "my live rows, changed since X", so index exactly that.
create index places_owner_live_idx
  on public.places (owner_id, updated_at)
  where deleted_at is null;

-- Deleted rows still need fetching so other devices learn about the deletion.
create index places_owner_updated_idx on public.places (owner_id, updated_at);

-- ─── lists ────────────────────────────────────────────────────────────────────
-- A list or a trip. Same table: a trip is a list that happens to have dates.
-- Keeping them as one thing means a list can become a trip later without moving
-- any data.

create table public.lists (
  id         uuid primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,

  name       text not null,
  -- 'list' for an ordinary collection, 'trip' when it has dates attached.
  kind       text not null default 'list' check (kind in ('list', 'trip')),
  start_date date,
  end_date   date,

  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create index lists_owner_live_idx
  on public.lists (owner_id, updated_at)
  where deleted_at is null;

-- ─── list_places ──────────────────────────────────────────────────────────────
-- Which places are in which lists. A separate table rather than a column on
-- places, because one place can be in several lists — "Madrid 2026" and
-- "Tapas places" and "Want to go" all at once.

create table public.list_places (
  list_id    uuid not null references public.lists (id)  on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  sort_order integer not null default 0,
  added_at   timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (list_id, place_id)
);

create index list_places_place_idx on public.list_places (place_id);
create index list_places_list_live_idx
  on public.list_places (list_id, sort_order)
  where deleted_at is null;

-- ─── list_shares ──────────────────────────────────────────────────────────────
-- Who can see which list. Only ever 'viewer' today; the column exists so an
-- editor role could be added without a migration.

create table public.list_shares (
  list_id    uuid not null references public.lists (id)     on delete cascade,
  user_id    uuid not null references auth.users (id)       on delete cascade,
  role       text not null default 'viewer' check (role in ('viewer')),
  shared_at  timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index list_shares_user_idx on public.list_shares (user_id);

-- ─── list_invites ─────────────────────────────────────────────────────────────
-- A share link before anyone has claimed it. The recipient opens the link,
-- signs in, and that moment turns this into a row in list_shares — which is how
-- an open link becomes a named person the owner can later remove.

create table public.list_invites (
  id         uuid primary key default uuid_generate_v4(),
  list_id    uuid not null references public.lists (id) on delete cascade,
  -- Random, unguessable, and the only secret in the link.
  token      text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Links do not live forever; an abandoned link should stop working.
  expires_at timestamptz not null default (now() + interval '30 days'),
  -- Set when the invite is revoked by the owner before anyone claims it.
  revoked_at timestamptz
);

create index list_invites_token_idx on public.list_invites (token);
create index list_invites_list_idx  on public.list_invites (list_id);

-- ─── blocks ───────────────────────────────────────────────────────────────────
-- Required by Apple once users can send each other content. A block is
-- one-directional: if A blocks B, B loses access to A's lists and cannot claim
-- any new invite of A's.

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

-- ─── reports ──────────────────────────────────────────────────────────────────
-- Also an Apple requirement. Apple expects reports to be acted on within 24
-- hours, so these are read by a human, not by code.

create table public.reports (
  id           uuid primary key default uuid_generate_v4(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  -- What is being reported. Nullable because the thing may be deleted later and
  -- the report should survive it.
  list_id      uuid references public.lists (id)   on delete set null,
  reported_id  uuid references auth.users (id)     on delete set null,
  reason       text not null,
  detail       text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- ─── usage ────────────────────────────────────────────────────────────────────
-- Per-user monthly counters, so the import limit survives reinstalling the app.
-- This is what replaces the device-side count, which anyone can reset.

create table public.usage (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- First day of the month this row covers, e.g. 2026-10-01.
  period      date not null,
  imports     integer not null default 0,
  searches    integer not null default 0,
  screenshots integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, period)
);

-- ─── plan_limits ──────────────────────────────────────────────────────────────
-- The actual numbers live here rather than in the app, so "2 free imports" can
-- become 5, or a paid tier can appear, WITHOUT shipping a new version to the
-- App Store and waiting for review.

create table public.plan_limits (
  plan        text primary key,
  imports     integer not null,
  searches    integer not null,
  screenshots integer not null,
  updated_at  timestamptz not null default now()
);

insert into public.plan_limits (plan, imports, searches, screenshots) values
  ('free', 2, 200, 20);

-- Which plan each user is on. Separate from profiles so billing can change
-- without touching the profile row.
create table public.user_plans (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  plan       text not null default 'free' references public.plan_limits (plan),
  updated_at timestamptz not null default now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
--
-- From here down is the entire access-control model. Every table denies
-- everything by default, and each policy below opens exactly one door.
--
-- The important one is places/lists: you can read a place if you own it, OR if
-- it sits in a list someone has shared with you. You can only ever WRITE your
-- own rows — which is what makes shares view-only, enforced by the database
-- rather than by remembering to check in the app.

alter table public.profiles     enable row level security;
alter table public.places       enable row level security;
alter table public.lists        enable row level security;
alter table public.list_places  enable row level security;
alter table public.list_shares  enable row level security;
alter table public.list_invites enable row level security;
alter table public.blocks       enable row level security;
alter table public.reports      enable row level security;
alter table public.usage        enable row level security;
alter table public.plan_limits  enable row level security;
alter table public.user_plans   enable row level security;

-- Does the current user have access to this list, either as owner or viewer?
-- Written once as a function so every policy agrees, and a block anywhere
-- removes access everywhere.
create or replace function public.can_view_list(target_list uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.lists l
    where l.id = target_list
      and l.deleted_at is null
      and (
        l.owner_id = auth.uid()
        or exists (
          select 1 from public.list_shares s
          where s.list_id = l.id
            and s.user_id = auth.uid()
            -- A block in either direction removes access
            and not exists (
              select 1 from public.blocks b
              where (b.blocker_id = l.owner_id and b.blocked_id = auth.uid())
                 or (b.blocker_id = auth.uid()  and b.blocked_id = l.owner_id)
            )
        )
      )
  );
$$;

-- profiles: everyone can read a profile (needed to show who shared a list),
-- but only you can change yours.
create policy profiles_select on public.profiles for select using (true);
create policy profiles_update on public.profiles for update using (id = auth.uid());

-- places: own everything; read others' only through a shared list
create policy places_select on public.places for select using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.list_places lp
    where lp.place_id = places.id
      and lp.deleted_at is null
      and public.can_view_list(lp.list_id)
  )
);
create policy places_insert on public.places for insert with check (owner_id = auth.uid());
create policy places_update on public.places for update using (owner_id = auth.uid());

-- lists
create policy lists_select on public.lists for select using (public.can_view_list(id));
create policy lists_insert on public.lists for insert with check (owner_id = auth.uid());
create policy lists_update on public.lists for update using (owner_id = auth.uid());

-- list_places
create policy list_places_select on public.list_places for select
  using (public.can_view_list(list_id));
create policy list_places_write on public.list_places for all
  using (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()));

-- list_shares: the owner manages them; you can see shares that are about you,
-- so the app can show "shared with you by X" and let you leave.
create policy list_shares_select on public.list_shares for select using (
  user_id = auth.uid()
  or exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid())
);
create policy list_shares_owner on public.list_shares for all
  using (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()));
-- Lets a recipient remove their own access without involving the owner.
create policy list_shares_self_delete on public.list_shares for delete using (user_id = auth.uid());

-- list_invites: only the owner sees or manages them. Claiming a link happens
-- through a function, not a direct read, so the token is never exposed.
create policy list_invites_owner on public.list_invites for all
  using (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()));

-- blocks: entirely your own business
create policy blocks_own on public.blocks for all
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- reports: you can file one and see your own. Nobody can read anyone else's.
create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid());
create policy reports_select on public.reports for select using (reporter_id = auth.uid());

-- usage and plans: readable by you, written only by the server
create policy usage_select      on public.usage      for select using (user_id = auth.uid());
create policy user_plans_select on public.user_plans for select using (user_id = auth.uid());
create policy plan_limits_select on public.plan_limits for select using (true);
