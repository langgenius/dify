-- Knowledge Platform schema migration
-- Migration id: 0032_capability_source_sync_policies
-- Dialect: postgres
-- Allows durable source sync policies to retain either a Capability grant or legacy ACL snapshot.

ALTER TABLE "source_sync_policies"
  ADD COLUMN IF NOT EXISTS "capability_grant_id" UUID,
  ALTER COLUMN "requested_by_subject_id" DROP NOT NULL,
  ALTER COLUMN "access_channel" DROP NOT NULL,
  ALTER COLUMN "permission_snapshot_id" DROP NOT NULL,
  ALTER COLUMN "permission_snapshot_revision" DROP NOT NULL,
  ALTER COLUMN "required_permission_scope" DROP NOT NULL;

ALTER TABLE "source_sync_policies"
  DROP CONSTRAINT IF EXISTS "source_sync_policies_channel_ck",
  DROP CONSTRAINT IF EXISTS "source_sync_policies_revision_ck",
  DROP CONSTRAINT IF EXISTS "source_sync_policies_authorization_binding_ck";

ALTER TABLE "source_sync_policies"
  ADD CONSTRAINT "source_sync_policies_channel_ck" CHECK (
    "access_channel" IS NULL
    OR "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  ADD CONSTRAINT "source_sync_policies_revision_ck" CHECK (
    "revision" >= 1 AND "expected_source_version" >= 1
    AND ("capability_grant_id" IS NOT NULL OR "permission_snapshot_revision" >= 1)
  ),
  ADD CONSTRAINT "source_sync_policies_authorization_binding_ck" CHECK (
    (
      "capability_grant_id" IS NOT NULL
      AND "requested_by_subject_id" IS NULL
      AND "access_channel" IS NULL
      AND "permission_snapshot_id" IS NULL
      AND "permission_snapshot_revision" IS NULL
      AND "required_permission_scope" IS NULL
    )
    OR (
      "capability_grant_id" IS NULL
      AND "requested_by_subject_id" IS NOT NULL
      AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
      AND "permission_snapshot_id" IS NOT NULL
      AND "permission_snapshot_revision" >= 1
      AND "required_permission_scope" IS NOT NULL
      AND jsonb_typeof("required_permission_scope") = 'array'
    )
  );

DO $kfs_0032_source_sync_policy_capability_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_sync_policies_capability_grant_fk'
      AND conrelid = 'source_sync_policies'::regclass
  ) THEN
    ALTER TABLE "source_sync_policies"
      ADD CONSTRAINT "source_sync_policies_capability_grant_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id", "capability_grant_id")
      REFERENCES "capability_grants" ("tenant_id", "knowledge_space_id", "grant_id")
      ON DELETE RESTRICT;
  END IF;
END
$kfs_0032_source_sync_policy_capability_fk$;

CREATE INDEX IF NOT EXISTS "source_sync_policies_capability_grant_idx"
  ON "source_sync_policies" (
    "tenant_id", "knowledge_space_id", "capability_grant_id"
  );
