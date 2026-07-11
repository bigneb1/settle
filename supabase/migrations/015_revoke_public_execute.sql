-- alloc_nonce/resync_nonce/update_merchant_totals were created with
-- Postgres's default EXECUTE grant to PUBLIC (which includes anon and
-- authenticated), never explicitly revoked - unlike the vault-credential
-- functions (store/read/delete_encrypted_credential), which
-- 011_credit_profile_schema.sql already correctly restricts.
--
-- Currently NOT exploitable: all three are plain (non-SECURITY DEFINER)
-- functions, so they run with the calling role's own privileges, and RLS
-- with zero anon/authenticated policies on nonce_alloc/merchants blocks the
-- actual writes underneath - verified live (an anon-role write attempt
-- fails with "new row violates row-level security policy"). This migration
-- removes the reliance on RLS as the *sole* barrier, matching the
-- least-privilege pattern already used for the vault functions, so a future
-- migration that adds an RLS policy or flips these to SECURITY DEFINER
-- doesn't silently reopen this.
revoke execute on function alloc_nonce(text) from public, anon, authenticated;
revoke execute on function resync_nonce(text, bigint) from public, anon, authenticated;
revoke execute on function update_merchant_totals(text, text, text, text) from public, anon, authenticated;
