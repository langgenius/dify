-- Knowledge Platform schema migration
-- Migration id: 0039_document_semantic_enrichment
-- Dialect: postgres
-- Moves optional graph extraction behind searchable publication with resumable node checkpoints.

CREATE TABLE IF NOT EXISTS "document_semantic_enrichment_jobs" (
  "id" UUID PRIMARY KEY,
  "compilation_attempt_id" UUID NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "parse_artifact_id" UUID NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "base_head_revision" BIGINT NOT NULL,
  "retrieval_profile" JSONB NOT NULL,
  "run_state" VARCHAR(24) NOT NULL,
  "execution_attempts" INTEGER NOT NULL DEFAULT 0,
  "max_execution_attempts" INTEGER NOT NULL,
  "available_at" TIMESTAMPTZ NOT NULL,
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "last_error_code" VARCHAR(128),
  "last_error_message" VARCHAR(2000),
  "result" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "row_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "document_semantic_enrichment_jobs_scope_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "document_semantic_enrichment_jobs_asset_fk"
    FOREIGN KEY ("knowledge_space_id", "document_asset_id", "document_version")
    REFERENCES "document_assets" ("knowledge_space_id", "id", "version") ON DELETE CASCADE,
  CONSTRAINT "document_semantic_enrichment_jobs_attempt_fk"
    FOREIGN KEY ("compilation_attempt_id")
    REFERENCES "document_compilation_attempts" ("id") ON DELETE CASCADE,
  CONSTRAINT "document_semantic_enrichment_jobs_generation_uq"
    UNIQUE ("tenant_id", "knowledge_space_id", "publication_generation_id"),
  CONSTRAINT "document_semantic_enrichment_jobs_state_ck"
    CHECK ("run_state" IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'superseded')),
  CONSTRAINT "document_semantic_enrichment_jobs_counts_ck"
    CHECK ("document_version" >= 1 AND "base_head_revision" >= 0 AND "execution_attempts" >= 0 AND "max_execution_attempts" >= 1 AND "execution_attempts" <= "max_execution_attempts" AND "row_version" >= 0),
  CONSTRAINT "document_semantic_enrichment_jobs_json_ck"
    CHECK (jsonb_typeof("retrieval_profile") = 'object' AND jsonb_typeof("result") = 'object'),
  CONSTRAINT "document_semantic_enrichment_jobs_lease_ck"
    CHECK (("run_state" = 'running' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL AND "completed_at" IS NULL) OR ("run_state" <> 'running' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL)),
  CONSTRAINT "document_semantic_enrichment_jobs_terminal_ck"
    CHECK (("run_state" IN ('succeeded', 'failed', 'superseded') AND "completed_at" IS NOT NULL) OR ("run_state" IN ('queued', 'running', 'retry_wait') AND "completed_at" IS NULL))
);

CREATE INDEX IF NOT EXISTS "document_semantic_enrichment_jobs_claim_idx"
  ON "document_semantic_enrichment_jobs" ("run_state", "available_at", "lease_expires_at", "updated_at", "id");

CREATE INDEX IF NOT EXISTS "document_semantic_enrichment_jobs_asset_idx"
  ON "document_semantic_enrichment_jobs" ("knowledge_space_id", "document_asset_id", "document_version");

CREATE TABLE IF NOT EXISTS "document_semantic_extraction_checkpoints" (
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "node_id" UUID NOT NULL,
  "stage" VARCHAR(16) NOT NULL,
  "input_fingerprint" VARCHAR(71) NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("tenant_id", "knowledge_space_id", "publication_generation_id", "node_id", "stage", "input_fingerprint"),
  CONSTRAINT "document_semantic_extraction_checkpoints_scope_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "document_semantic_extraction_checkpoints_asset_fk"
    FOREIGN KEY ("knowledge_space_id", "document_asset_id", "document_version")
    REFERENCES "document_assets" ("knowledge_space_id", "id", "version") ON DELETE CASCADE,
  CONSTRAINT "document_semantic_extraction_checkpoints_stage_ck"
    CHECK ("stage" IN ('entity', 'relation')),
  CONSTRAINT "document_semantic_extraction_checkpoints_fingerprint_ck"
    CHECK ("input_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "document_semantic_extraction_checkpoints_result_ck"
    CHECK (jsonb_typeof("result") = 'object')
);

CREATE INDEX IF NOT EXISTS "document_semantic_extraction_checkpoints_asset_idx"
  ON "document_semantic_extraction_checkpoints" ("knowledge_space_id", "document_asset_id", "document_version");
