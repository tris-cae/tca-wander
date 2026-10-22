-- ─── Server-side functions ───────────────────────────────────────────────────
--
-- Two things the app cannot do directly, for good reasons:
--
--   claim_invite    The recipient must not be able to read the invites table
--                   (that would let them hunt for other people's tokens), but
--                   they do need to turn a token into access. So the check runs
--                   here, where it can see the table but only answers one
--                   question: "is this exact token valid, and if so give me
--                   access to that one list."
--
--   delete_account  Apple requires account deletion from inside the app.
--                   Deleting your own login record is not something a normal
--                   client is allowed to do, so it happens here.
--
-- Both are `security definer`, meaning they run with elevated rights. That makes
-- them the two most security-sensitive pieces of the backend, which is why each
-- one checks who is calling before doing anything.

-- ─── Claiming a share link ────────────────────────────────────────────────────

create or replace function public.claim_invite(invite_token text)
returns uuid                      -- the list that was joined
language plpgsql
security definer set search_path = public
as $$
declare
  invite    public.list_invites%rowtype;
  list_row  public.lists%rowtype;
  caller    uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You need to be signed in to open a shared list';
  end if;

  select * into invite
    from public.list_invites
   where token = invite_token;

  -- Deliberately the same message for "no such token" and "expired", so a
  -- stranger cannot use the difference to work out which tokens exist.
  if not found
     or invite.revoked_at is not null
     or invite.expires_at < now() then
    raise exception 'That link is no longer valid';
  end if;

  select * into list_row from public.lists where id = invite.list_id;

  if not found or list_row.deleted_at is not null then
    raise exception 'That list no longer exists';
  end if;

  -- Opening your own link is harmless; just hand back the list.
  if list_row.owner_id = caller then
    return list_row.id;
  end if;

  -- A block in either direction stops the share from being created at all,
  -- rather than creating it and filtering it out on every later read.
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = list_row.owner_id and b.blocked_id = caller)
       or (b.blocker_id = caller and b.blocked_id = list_row.owner_id)
  ) then
    raise exception 'That link is no longer valid';
  end if;

  insert into public.list_shares (list_id, user_id, role)
  values (list_row.id, caller, 'viewer')
  on conflict (list_id, user_id) do nothing;   -- opening the link twice is fine

  return list_row.id;
end;
$$;

revoke all on function public.claim_invite(text) from public;
grant execute on function public.claim_invite(text) to authenticated;

-- ─── Deleting your account ────────────────────────────────────────────────────
--
-- Apple Guideline 5.1.1(v): if an app offers account creation, it must offer
-- account deletion from inside the app. Not an email address to write to.
--
-- Everything hangs off auth.users with `on delete cascade`, so removing that one
-- row removes the places, lists, shares, invites, blocks and usage with it. The
-- only exception is reports, which keep a record with the user detached, so a
-- complaint about someone cannot be erased by the person complained about.

create or replace function public.delete_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You need to be signed in to delete your account';
  end if;

  -- Keep reports, detach the reporter. The report survives the account.
  update public.reports set reporter_id = null where reporter_id = caller;

  -- Everything else cascades from here.
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;

-- reports.reporter_id has to allow null for the detach above to work.
alter table public.reports alter column reporter_id drop not null;
alter table public.reports
  drop constraint if exists reports_reporter_id_fkey,
  add constraint reports_reporter_id_fkey
    foreign key (reporter_id) references auth.users (id) on delete set null;

-- ─── Sync helper ──────────────────────────────────────────────────────────────
--
-- "Give me everything that changed since I last asked." Deleted rows are
-- included on purpose — that is how a phone finds out something was removed
-- somewhere else.

create or replace function public.changes_since(since timestamptz)
returns table (
  table_name text,
  payload    jsonb
)
language sql
stable
security definer set search_path = public
as $$
  select 'places', to_jsonb(p) from public.places p
    where p.owner_id = auth.uid() and p.updated_at > since
  union all
  select 'lists', to_jsonb(l) from public.lists l
    where l.owner_id = auth.uid() and l.updated_at > since
  union all
  select 'list_places', to_jsonb(lp) from public.list_places lp
    join public.lists l on l.id = lp.list_id
    where l.owner_id = auth.uid() and lp.updated_at > since;
$$;

revoke all on function public.changes_since(timestamptz) from public;
grant execute on function public.changes_since(timestamptz) to authenticated;
