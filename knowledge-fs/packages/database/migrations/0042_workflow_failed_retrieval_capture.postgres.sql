-- Knowledge Platform schema migration
-- Migration id: 0042_workflow_failed_retrieval_capture
-- Dialect: postgres
-- Workflow empty-retrieval events retain their admitted Capability provenance and frozen scope.

ALTER TABLE "failed_queries"
  ADD COLUMN IF NOT EXISTS "capability_grant_id" UUID;

ALTER TABLE "failed_queries"
  DROP CONSTRAINT IF EXISTS "failed_queries_permission_binding_ck";

ALTER TABLE "failed_queries"
  ADD CONSTRAINT "failed_queries_permission_binding_ck" CHECK (
    ("tenant_id" IS NULL AND "capability_grant_id" IS NULL
      AND "requested_by_subject_id" IS NULL AND "access_channel" IS NULL
      AND "permission_snapshot_id" IS NULL AND "permission_snapshot_revision" IS NULL
      AND "required_permission_scope" IS NULL AND "revision" IS NULL)
    OR ("tenant_id" IS NOT NULL AND "capability_grant_id" IS NOT NULL
      AND "requested_by_subject_id" IS NULL AND "access_channel" IS NULL
      AND "permission_snapshot_id" IS NULL AND "permission_snapshot_revision" IS NULL
      AND "required_permission_scope" IS NOT NULL
      AND jsonb_typeof("required_permission_scope") = 'array'
      AND "revision" IS NOT NULL AND "revision" >= 1)
    OR ("tenant_id" IS NOT NULL AND "capability_grant_id" IS NULL
      AND "requested_by_subject_id" IS NOT NULL
      AND "access_channel" IS NOT NULL
      AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
      AND "permission_snapshot_id" IS NOT NULL
      AND "permission_snapshot_revision" IS NOT NULL
      AND "permission_snapshot_revision" >= 1
      AND "required_permission_scope" IS NOT NULL
      AND jsonb_typeof("required_permission_scope") = 'array'
      AND "revision" IS NOT NULL AND "revision" >= 1)
  );

DO $kfs_0042_failed_query_capability_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'failed_queries_capability_grant_fk'
      AND conrelid = 'failed_queries'::regclass
  ) THEN
    ALTER TABLE "failed_queries"
      ADD CONSTRAINT "failed_queries_capability_grant_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id", "capability_grant_id")
      REFERENCES "capability_grants" ("tenant_id", "knowledge_space_id", "grant_id")
      ON DELETE RESTRICT;
  END IF;
END
$kfs_0042_failed_query_capability_fk$;

CREATE INDEX IF NOT EXISTS "failed_queries_capability_grant_idx"
  ON "failed_queries" ("tenant_id", "knowledge_space_id", "capability_grant_id");
