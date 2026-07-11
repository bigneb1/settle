-- Atomic nonce allocator for serverless on-chain writes.
--
-- Problem: Vercel serverless functions have no shared in-memory state across
-- invocations, so concurrent calls that sign with the SAME deployer key
-- (e.g. checkout/create.js → ChargeRegistry.createCharge) race on the wallet's
-- next nonce → "nonce too low" / "replacement underpriced" reverts.
--
-- Fix: a single row per wallet address, incremented atomically. The
-- UPDATE ... RETURNING is the lock - Postgres serializes the increment, so
-- two concurrent invocations never receive the same nonce.

create table if not exists nonce_alloc (
  wallet      text primary key,        -- lowercase hex EOA address
  next_nonce  bigint not null default 0,
  updated_at  timestamptz default now()
);

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
$$ language plpgsql;

-- Re-sync the allocator forward to a chain-derived floor (used on retry after
-- a "nonce too low" / replacement-underpriced revert). Never moves the row
-- backward - only forward to max(current, floor).
create or replace function resync_nonce(w text, floor bigint) returns bigint as $$
begin
  insert into nonce_alloc (wallet, next_nonce)
  values (w, floor + 1)
  on conflict (wallet) do update
    set next_nonce = greatest(nonce_alloc.next_nonce, floor + 1),
        updated_at = now();
  return greatest(nonce_alloc.next_nonce, floor);
end;
$$ language plpgsql;
