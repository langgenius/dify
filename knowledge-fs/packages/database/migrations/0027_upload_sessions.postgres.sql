-- Knowledge Platform schema migration
-- Migration id: 0027_upload_sessions
-- Dialect: postgres
-- Object bytes never pass through this table; presigned URLs and bearer tokens are never stored.

CREATE TABLE IF NOT EXISTS "upload_sessions" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "grant_id" UUID NOT NULL,
  "completion_grant_id" UUID,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "object_key" VARCHAR(1024) NOT NULL,
  "file_name" VARCHAR(512) NOT NULL,
  "content_type" VARCHAR(255) NOT NULL,
  "checksum_sha256_base64" VARCHAR(255) NOT NULL,
  "expected_size_bytes" BIGINT NOT NULL,
  "reserved_bytes" BIGINT NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "multipart_upload_id" VARCHAR(1024),
  "multipart_part_size_bytes" BIGINT,
  "multipart_part_count" INTEGER,
  "status" VARCHAR(16) NOT NULL,
  "completion_parts" JSONB NOT NULL,
  "document_asset_id" UUID,
  "compilation_job_id" UUID,
  "error_code" VARCHAR(64),
  "expires_at" BIGINT NOT NULL,
  "aborted_at" BIGINT,
  "completed_at" BIGINT,
  "row_version" INTEGER NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "upload_sessions_state_ck" CHECK (
    "mode" IN ('single', 'multipart', 'small_fallback')
    AND "status" IN (
      'creating', 'ready', 'completing', 'completed',
      'aborting', 'aborted', 'expired', 'failed'
    )
  ),
  CONSTRAINT "upload_sessions_bounds_ck" CHECK (
    "expected_size_bytes" >= 1
    AND "reserved_bytes" >= 0
    AND "reserved_bytes" <= "expected_size_bytes"
    AND "row_version" >= 1
    AND "expires_at" > "created_at"
  ),
  CONSTRAINT "upload_sessions_multipart_ck" CHECK (
    ("mode" = 'multipart'
      AND "multipart_part_size_bytes" IS NOT NULL
      AND "multipart_part_count" IS NOT NULL
      AND "multipart_part_size_bytes" >= 5242880
      AND "multipart_part_count" BETWEEN 1 AND 10000)
    OR
    ("mode" <> 'multipart'
      AND "multipart_upload_id" IS NULL
      AND "multipart_part_size_bytes" IS NULL
      AND "multipart_part_count" IS NULL)
  ),
  CONSTRAINT "upload_sessions_terminal_ck" CHECK (
    (("status" = 'completed'
        AND "completed_at" IS NOT NULL
        AND "document_asset_id" IS NOT NULL
        AND "compilation_job_id" IS NOT NULL
        AND "reserved_bytes" = 0)
      OR ("status" <> 'completed'
        AND "completed_at" IS NULL
        AND "document_asset_id" IS NULL
        AND "compilation_job_id" IS NULL))
    AND (("status" = 'aborted' AND "aborted_at" IS NOT NULL AND "reserved_bytes" = 0)
      OR ("status" <> 'aborted' AND "aborted_at" IS NULL))
    AND ("status" NOT IN ('expired', 'failed') OR "reserved_bytes" = 0)
  ),
  CONSTRAINT "upload_sessions_completion_grant_ck" CHECK (
    (("status" IN ('completing', 'completed') AND "completion_grant_id" IS NOT NULL)
      OR ("status" NOT IN ('completing', 'completed') AND "completion_grant_id" IS NULL))
  ),
  CONSTRAINT "upload_sessions_completion_parts_ck" CHECK (
    jsonb_typeof("completion_parts") = 'array'
  ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id", "knowledge_space_id", "grant_id")
    REFERENCES "capability_grants" ("tenant_id", "knowledge_space_id", "grant_id"),
  FOREIGN KEY ("tenant_id", "knowledge_space_id", "completion_grant_id")
    REFERENCES "capability_grants" ("tenant_id", "knowledge_space_id", "grant_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "upload_sessions_scope_idempotency_uq"
  ON "upload_sessions" ("tenant_id", "knowledge_space_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "upload_sessions_object_key_uq"
  ON "upload_sessions" ("object_key");
CREATE INDEX IF NOT EXISTS "upload_sessions_expiry_idx"
  ON "upload_sessions" ("tenant_id", "status", "expires_at", "id");
CREATE INDEX IF NOT EXISTS "upload_sessions_grant_status_idx"
  ON "upload_sessions" (
    "tenant_id", "knowledge_space_id", "grant_id", "status", "id"
  );
CREATE INDEX IF NOT EXISTS "upload_sessions_completion_grant_status_idx"
  ON "upload_sessions" (
    "tenant_id", "knowledge_space_id", "completion_grant_id", "status", "id"
  );
