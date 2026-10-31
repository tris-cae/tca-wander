-- ─── Close the anon grant on the security-definer functions ──────────────────
--
-- 0002 ended each function with:
--
--   revoke all on function ... from public;
--   grant execute on function ... to authenticated;
--
-- which reads like "only signed-in users may call this" but is not what
-- happened. Supabase ships a default-privileges rule that grants EXECUTE on
-- every new function in `public` directly to the `anon` role. Revoking from
-- PUBLIC does not remove a grant held directly by a role, so `anon` kept its
-- own copy and the revoke was a no-op for it.
--
-- Verified against the live database on 2026-10-22: an unauthenticated request
-- reached claim_invite() and delete_account() and was stopped by the
-- `auth.uid() is null` check inside each one, rather than at the door. Nothing
-- leaked and nothing was deletable — those checks are why this was a tidy-up
-- and not an incident — but a stranger should not be able to reach the body of
-- a security-definer function at all. Two locks beat one.
--
-- changes_since() has no such check because it does not need one: it filters on
-- `owner_id = auth.uid()`, and for an anonymous caller that is `owner_id = null`,
-- which is never true. It returned zero rows when tested. Still revoked here, so
-- the three functions are consistent and the next person does not have to work
-- out which of them is safe by reading the bodies.

revoke execute on function public.claim_invite(text)          from anon;
revoke execute on function public.delete_account()            from anon;
revoke execute on function public.changes_since(timestamptz)  from anon;

-- can_view_list() is only ever called from inside the RLS policies, never by
-- the app over the API. Nobody needs to call it directly.
revoke execute on function public.can_view_list(uuid) from anon, authenticated;

-- Stop the same thing happening to functions added later. Without this, every
-- future migration would quietly re-open the same door.
alter default privileges in schema public revoke execute on functions from anon;
