-- Marks merchants seeded for demo purposes (empty-catalog bootstrap) so the
-- frontend can label them clearly instead of presenting them as real,
-- unlabeled merchant activity. Real merchants (registered via the normal
-- onboarding flow) default to false; demo rows are flagged true by a
-- one-off UPDATE after they're created through the same real on-chain +
-- backend-verified onboarding path every merchant goes through - no
-- fabricated data, just a label on real seed rows.
alter table merchants add column if not exists is_demo boolean not null default false;
