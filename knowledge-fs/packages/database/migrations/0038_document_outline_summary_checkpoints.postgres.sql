-- Knowledge Platform schema migration
-- Migration id: 0038_document_outline_summary_checkpoints
-- Dialect: postgres
-- Persists exact-input outline summary batches so timed-out compilations resume completed LLM work.

CREATE TABLE IF NOT EXISTS "document_outline_summary_checkpoints" (
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "outline_node_id" VARCHAR(255) NOT NULL,
  "input_fingerprint" VARCHAR(71) NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (
    "tenant_id", "knowledge_space_id", "publication_generation_id",
    "outline_node_id", "input_fingerprint"
  ),
  CONSTRAINT "document_outline_summary_checkpoints_scope_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "document_outline_summary_checkpoints_asset_fk"
    FOREIGN KEY ("knowledge_space_id", "document_asset_id", "document_version")
    REFERENCES "document_assets" ("knowledge_space_id", "id", "version") ON DELETE CASCADE,
  CONSTRAINT "document_outline_summary_checkpoints_fingerprint_ck"
    CHECK ("input_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "document_outline_summary_checkpoints_metadata_ck"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "document_outline_summary_checkpoints_version_ck"
    CHECK ("document_version" >= 1)
);

CREATE INDEX IF NOT EXISTS "document_outline_summary_checkpoints_asset_idx"
  ON "document_outline_summary_checkpoints" (
    "knowledge_space_id", "document_asset_id", "document_version"
  );
