-- Lightweight bearer-session table for non-transaction profile actions
-- (backend/src/session.js) - lets a buyer sign once (a real Magic popup)
-- and reuse a session token afterward for read-only/non-fund-moving calls
-- (profile/get, exchange connect/sync/disconnect/details, dev-identity
-- disconnect) instead of re-signing on every request. Anything that moves
-- funds or creates an on-chain charge (checkout, down payment, Pay Now, DCA
-- buy, Convert, Send, merchant onboarding) is deliberately NOT covered by
-- this table and keeps requiring a real signature or on-chain proof.
create table if not exists buyer_sessions (
  token       text primary key,
  buyer       text not null,
  created_at  timestamptz default now(),
  expires_at  timestamptz not null
);

create index if not exists idx_buyer_sessions_buyer on buyer_sessions(buyer);

alter table buyer_sessions enable row level security;
-- Deliberately no policies for anon/authenticated - default-deny, matching
-- every other table in this schema. service_role (backend only) bypasses RLS.
