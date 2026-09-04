-- Knowledge Platform schema migration
-- Migration id: 0052_namespace_source_previews
-- Dialect: postgres

CREATE TABLE IF NOT EXISTS "namespace_source_preview_jobs" (
  "id" uuid PRIMARY KEY,
  "tenant_id" varchar(255) NOT NULL,
  "account_id" varchar(255) NOT NULL,
  "status" varchar(32) NOT NULL,
  "provider_config" jsonb NOT NULL,
  "configuration_fingerprint" varchar(128) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz NULL,
  "content_cleaned_at" timestamptz NULL,
  "import_workflow_id" uuid NULL,
  "error_code" varchar(128) NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "namespace_source_preview_jobs_claim_idx"
  ON "namespace_source_preview_jobs" ("status", "expires_at", "created_at");
CREATE INDEX IF NOT EXISTS "namespace_source_preview_jobs_owner_idx"
  ON "namespace_source_preview_jobs" ("tenant_id", "account_id", "created_at");
CREATE INDEX IF NOT EXISTS "namespace_source_preview_jobs_cleanup_idx"
  ON "namespace_source_preview_jobs" ("status", "content_cleaned_at", "updated_at");

CREATE TABLE IF NOT EXISTS "namespace_source_preview_pages" (
  "job_id" uuid NOT NULL REFERENCES "namespace_source_preview_jobs" ("id") ON DELETE CASCADE,
  "page_id" varchar(128) NOT NULL,
  "source_url" varchar(4096) NOT NULL,
  "title" varchar(500) NULL,
  "description" text NULL,
  "content_hash" varchar(64) NOT NULL,
  "content_object_key" varchar(2048) NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("job_id", "page_id")
);
