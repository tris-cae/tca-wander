-- ─── Stale writes lose ────────────────────────────────────────────────────────
--
-- The sync design agreed for Build 3: the phone sends each change with the
-- timestamp of when it happened on the phone, and the server keeps whichever
-- version is newer. This trigger is the half of that rule that lives on the
-- server, and it exists because the phone cannot be trusted to send things in
-- order.
--
-- The case it is for. You edit a place on a plane. The change goes into the
-- phone's outbox and waits. You land, open the app on an iPad, and edit the
-- same place again. The iPad's change reaches the server first. Then the phone
-- reconnects and sends its older change. Without this trigger the older edit
-- would land last and win, silently undoing the newer one — the user watches
-- their correction get replaced by the thing they corrected.
--
-- With it, the older write is dropped on arrival. The phone's copy is then out
-- of date, which the next pull fixes, because the pull hands back the newer
-- server row and the phone overwrites its own.
--
-- Why a trigger rather than a check in the app: there is no single app. There
-- are many phones, several versions of the app at once, and eventually a web
-- client. A rule that matters this much belongs where every one of them has to
-- go through it.
--
-- Equal timestamps are allowed through. Re-sending the identical row is how a
-- retry after a dropped connection works, and that must not be treated as an
-- error.

create or replace function public.reject_stale_write()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at < old.updated_at then
    -- Returning OLD rather than raising: a stale write is an expected part of
    -- normal syncing, not a failure. Raising would make the phone retry
    -- forever, since sending it again would always be just as stale.
    return old;
  end if;
  return new;
end;
$$;

create trigger places_reject_stale_write
  before update on public.places
  for each row execute function public.reject_stale_write();

create trigger lists_reject_stale_write
  before update on public.lists
  for each row execute function public.reject_stale_write();

create trigger list_places_reject_stale_write
  before update on public.list_places
  for each row execute function public.reject_stale_write();
