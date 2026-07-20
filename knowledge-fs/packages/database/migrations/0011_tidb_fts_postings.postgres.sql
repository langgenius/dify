-- Knowledge Platform schema migration
-- Migration id: 0011_tidb_fts_postings
-- Dialect: postgres

-- PostgreSQL continues to query index_projections.fts_document through its native GIN index.
-- Keep the portable posting catalog available so the schema and lifecycle contract remain the
-- same across database dialects; application writes populate it only for TiDB.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projection_set_publications_status_ck'
      AND conrelid = 'projection_set_publications'::regclass
  ) THEN
    ALTER TABLE "projection_set_publications"
      ADD CONSTRAINT "projection_set_publications_status_ck"
      CHECK ("status" IN ('candidate', 'inactive', 'published', 'superseded', 'validating'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "index_projections_space_id_uq"
  ON "index_projections" ("knowledge_space_id", "id");
CREATE INDEX IF NOT EXISTS "index_projections_fts_backfill_idx"
  ON "index_projections" ("knowledge_space_id", "id");

CREATE TABLE IF NOT EXISTS "index_projection_fts_postings" (
  "id" UUID PRIMARY KEY NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "projection_id" UUID NOT NULL,
  "tokenizer_version" VARCHAR(64) NOT NULL,
  "term_hash" CHAR(64) NOT NULL,
  "term" VARCHAR(128) NOT NULL,
  "term_frequency" INTEGER NOT NULL,
  "document_token_count" INTEGER NOT NULL,
  CONSTRAINT "index_projection_fts_postings_frequency_ck"
    CHECK ("term_frequency" > 0 AND "document_token_count" >= "term_frequency"),
  FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("knowledge_space_id", "projection_id")
    REFERENCES "index_projections" ("knowledge_space_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "index_projection_fts_postings_projection_term_uq"
  ON "index_projection_fts_postings" ("projection_id", "tokenizer_version", "term_hash");
CREATE INDEX IF NOT EXISTS "index_projection_fts_postings_lookup_idx"
  ON "index_projection_fts_postings" ("knowledge_space_id", "term_hash", "projection_id");

-- A durable, tenant-scoped cursor replaces any migration-runner backfill. Deployments can first
-- enable the transactional dual writer, then let the bounded runtime lease and repair old spaces.
-- PostgreSQL does not consume this ledger for native GIN reads, but retaining the table in both
-- dialects keeps schema replay, operational tooling, and disaster-recovery artifacts symmetric.
CREATE TABLE IF NOT EXISTS "tidb_fts_posting_backfills" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "tokenizer_version" VARCHAR(64) NOT NULL,
  "run_state" VARCHAR(16) NOT NULL,
  "cursor_projection_id" UUID,
  "scanned_projections" INTEGER NOT NULL,
  "written_postings" INTEGER NOT NULL,
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "retry_count" INTEGER NOT NULL,
  "row_version" INTEGER NOT NULL,
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "tidb_fts_posting_backfills_state_ck"
    CHECK ("run_state" IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT "tidb_fts_posting_backfills_counts_ck"
    CHECK (
      "scanned_projections" >= 0
      AND "written_postings" >= 0
      AND "retry_count" >= 0
      AND "row_version" >= 0
    ),
  CONSTRAINT "tidb_fts_posting_backfills_lease_ck"
    CHECK (
      (
        "run_state" = 'running'
        AND "worker_id" IS NOT NULL
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "heartbeat_at" IS NOT NULL
        AND "completed_at" IS NULL
      )
      OR (
        "run_state" <> 'running'
        AND "worker_id" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "heartbeat_at" IS NULL
      )
    ),
  CONSTRAINT "tidb_fts_posting_backfills_terminal_ck"
    CHECK (
      ("run_state" IN ('succeeded', 'failed') AND "completed_at" IS NOT NULL)
      OR ("run_state" IN ('queued', 'running') AND "completed_at" IS NULL)
    ),
  CONSTRAINT "tidb_fts_posting_backfills_lease_token_ck"
    CHECK (
      "lease_token" IS NULL
      OR "lease_token" <> '00000000-0000-0000-0000-000000000000'::uuid
    ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tidb_fts_posting_backfills_space_tokenizer_uq"
  ON "tidb_fts_posting_backfills" (
    "tenant_id", "knowledge_space_id", "tokenizer_version"
  );
CREATE INDEX IF NOT EXISTS "tidb_fts_posting_backfills_claim_idx"
  ON "tidb_fts_posting_backfills" (
    "run_state", "lease_expires_at", "updated_at", "id"
  );
CREATE INDEX IF NOT EXISTS "tidb_fts_posting_backfills_scope_idx"
  ON "tidb_fts_posting_backfills" (
    "tenant_id", "knowledge_space_id", "tokenizer_version", "id"
  );
