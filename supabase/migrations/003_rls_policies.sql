-- Public read on all on-chain-derived tables (no more sensitive than a block
-- explorer) via the anon key; all writes stay service_role-only (used
-- server-side by the indexer edge function and the backend's checkout/onboard
-- endpoints, never by the anon key).

alter table catalog_items    enable row level security;
alter table merchants        enable row level security;
alter table merchant_payouts enable row level security;
alter table sweeps           enable row level security;
alter table charges          enable row level security;
alter table indexer_state    enable row level security;

create policy "public read catalog_items"    on catalog_items    for select using (true);
create policy "public read merchants"        on merchants        for select using (true);
create policy "public read merchant_payouts" on merchant_payouts for select using (true);
create policy "public read sweeps"           on sweeps           for select using (true);
create policy "public read charges"          on charges          for select using (true);
-- Deliberately no insert/update/delete policy for anon/authenticated anywhere,
-- and no policy at all on indexer_state (default-deny). service_role bypasses
-- RLS by default.
