-- Adds BNPL/subscription charge fields to catalog_items (needed to construct a
-- real ChargeRegistry.createCharge() call from a catalog row) and links charges
-- back to the catalog item they were created from (for human-readable "plan" display).

alter table catalog_items
  add column if not exists charge_type   smallint not null default 0,   -- 0=BNPL, 1=Subscription
  add column if not exists total_cycles  bigint    not null default 0,  -- 0 = indefinite/subscription
  add column if not exists cycle_seconds bigint    not null default 2592000; -- 30 days

alter table charges
  add column if not exists catalog_item_id bigint references catalog_items(id);

create index if not exists idx_catalog_items_merchant on catalog_items(merchant);
create index if not exists idx_catalog_items_active   on catalog_items(active);
create index if not exists idx_charges_catalog_item   on charges(catalog_item_id);
