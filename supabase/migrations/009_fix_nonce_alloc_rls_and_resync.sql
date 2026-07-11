-- Two bugs found in 007_nonce_allocator.sql:
--
-- 1. resync_nonce() has an invalid bare `RETURN greatest(nonce_alloc.next_nonce, floor)`
--    referencing a table column outside a query/RETURNING context — this is
--    illegal in PL/pgSQL and throws on every call, verified live. It's the
--    only recovery path after a "nonce too low" revert, so leaving it broken
--    means a stuck signing wallet stays stuck forever. Fixed by capturing the
--    post-upsert value via RETURNING on the INSERT itself, mirroring alloc_nonce.
--
-- 2. nonce_alloc was created in 007, AFTER 003_rls_policies.sql enabled RLS on
--    every other table, and nobody revisited it — RLS was never enabled on it.
--    It holds the live nonce counter for the deployer/sweep-agent signing
--    wallet, and with RLS off it's reachable (read AND write) through
--    PostgREST via the public anon key shipped in the frontend bundle.
--    Anyone could PATCH next_nonce to an arbitrary value and permanently
--    stall every backend-signed transaction. Fixed by enabling RLS with zero
--    policies (default-deny), matching indexer_state's existing pattern.
--
-- Also: neither alloc_nonce nor resync_nonce had `search_path` pinned, which
-- 005_fix_function_search_path.sql was meant to close for every SECURITY
-- DEFINER-adjacent function in this schema — re-applying that hardening here
-- since these two postdate that migration.

create or replace function resync_nonce(w text, floor bigint) returns bigint as $$
declare
  result bigint;
begin
  insert into nonce_alloc (wallet, next_nonce)
  values (w, floor + 1)
  on conflict (wallet) do update
    set next_nonce = greatest(nonce_alloc.next_nonce, floor + 1),
        updated_at = now()
  returning nonce_alloc.next_nonce into result;
  return result;
end;
$$ language plpgsql set search_path = public;

create or replace function alloc_nonce(w text) returns bigint as $$
declare
  allocated bigint;
begin
  insert into nonce_alloc (wallet, next_nonce)
  values (w, 1)
  on conflict (wallet) do update
    set next_nonce = nonce_alloc.next_nonce + 1,
        updated_at = now()
  returning nonce_alloc.next_nonce - 1 into allocated;
  return coalesce(allocated, 0);
end;
$$ language plpgsql set search_path = public;

alter table nonce_alloc enable row level security;
-- Deliberately no policies for anon/authenticated — default-deny, matching
-- indexer_state. service_role (the only caller, via checkout/create.js's
-- supabaseAdmin.rpc()) bypasses RLS.
