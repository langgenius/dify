-- Knowledge Platform schema migration
-- Migration id: 0030_bulk_operations
-- Dialect: postgres
-- Persists user-visible bulk document tasks so progress and controls survive process restarts.

CREATE TABLE IF NOT EXISTS "bulk_operations" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "operation_type" VARCHAR(32) NOT NULL,
  "items" JSONB NOT NULL,
  "required_permission_scope" JSONB NOT NULL,
  "has_not_found_items" BOOLEAN NOT NULL DEFAULT FALSE,
  "capability_grant_id" UUID,
  "permission_access_channel" VARCHAR(16),
  "permission_snapshot_id" UUID,
  "permission_snapshot_revision" BIGINT,
  "requested_by_subject_id" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "bulk_operations_space_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "bulk_operations_type_ck"
    CHECK ("operation_type" IN ('document_upload', 'document_delete', 'document_reindex')),
  CONSTRAINT "bulk_operations_items_ck"
    CHECK (jsonb_typeof("items") = 'array'),
  CONSTRAINT "bulk_operations_scope_ck"
    CHECK (jsonb_typeof("required_permission_scope") = 'array'),
  CONSTRAINT "bulk_operations_permission_ck"
    CHECK (
      (
        "permission_access_channel" IS NULL
        AND "permission_snapshot_id" IS NULL
        AND "permission_snapshot_revision" IS NULL
      )
      OR (
        "permission_access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
        AND "permission_snapshot_id" IS NOT NULL
        AND "permission_snapshot_revision" >= 1
        AND "requested_by_subject_id" IS NOT NULL
      )
    ),
  CONSTRAINT "bulk_operations_authorization_ck"
    CHECK (
      ("capability_grant_id" IS NOT NULL AND "permission_snapshot_id" IS NULL)
      OR ("capability_grant_id" IS NULL AND "permission_snapshot_id" IS NOT NULL)
    ),
  CONSTRAINT "bulk_operations_capability_grant_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id", "capability_grant_id")
    REFERENCES "capability_grants" ("tenant_id", "knowledge_space_id", "grant_id")
    ON DELETE RESTRICT,
  CONSTRAINT "bulk_operations_permission_snapshot_fk"
    FOREIGN KEY (
      "tenant_id", "knowledge_space_id", "permission_snapshot_id",
      "requested_by_subject_id", "permission_access_channel"
    ) REFERENCES "knowledge_space_permission_snapshots" (
      "tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"
    ) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "bulk_operations_space_created_idx"
  ON "bulk_operations" ("tenant_id", "knowledge_space_id", "created_at" DESC, "id" DESC);
