-- Hardening flagged by Supabase's security advisor: pin update_merchant_totals'
-- search_path so it can't be hijacked by a role-local search_path change.
alter function update_merchant_totals(text, text, text, text) set search_path = public;
