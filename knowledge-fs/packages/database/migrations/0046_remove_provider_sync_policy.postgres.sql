-- Knowledge Platform schema migration
-- Migration id: 0046_remove_provider_sync_policy
-- Dialect: postgres
-- Historical provider policies must be converted to manual before this migration runs.

ALTER TABLE "source_sync_policies"
  DROP CONSTRAINT IF EXISTS "source_sync_policies_mode_ck";

ALTER TABLE "source_sync_policies"
  ADD CONSTRAINT "source_sync_policies_mode_ck"
  CHECK ("mode" IN ('manual', 'interval', 'custom'));
