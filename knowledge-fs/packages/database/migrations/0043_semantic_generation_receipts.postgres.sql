-- Knowledge Platform schema migration
-- Migration id: 0043_semantic_generation_receipts
-- Dialect: postgres

CREATE TABLE IF NOT EXISTS "knowledge_node_generation_receipts" (
  "knowledge_space_id" UUID NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "parse_artifact_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "artifact_hash" VARCHAR(64) NOT NULL,
  "document_chunk_count" INTEGER NOT NULL,
  "stored_node_count" INTEGER NOT NULL,
  "request_fingerprint" VARCHAR(71) NOT NULL,
  "response_fingerprint" VARCHAR(71) NOT NULL,
  "prompt_response_fingerprint" VARCHAR(71) NOT NULL,
  "receipt" JSONB NOT NULL,
  PRIMARY KEY ("knowledge_space_id", "publication_generation_id", "parse_artifact_id"),
  CONSTRAINT "knowledge_node_generation_receipts_counts_ck" CHECK (
    "document_chunk_count" >= 0 AND "stored_node_count" >= 0
    AND "stored_node_count" <= "document_chunk_count"
  ),
  CONSTRAINT "knowledge_node_generation_receipts_hashes_ck" CHECK (
    "artifact_hash" ~ '^[a-f0-9]{64}$'
    AND "request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'
    AND "response_fingerprint" ~ '^sha256:[a-f0-9]{64}$'
    AND "prompt_response_fingerprint" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "knowledge_node_generation_receipts_json_ck"
    CHECK (jsonb_typeof("receipt") = 'object'),
  CONSTRAINT "knowledge_node_generation_receipts_bytes_ck"
    CHECK (octet_length("receipt"::text) <= 8388608),
  CONSTRAINT "knowledge_node_generation_receipts_pub_gen_nonzero_ck"
    CHECK ("publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid),
  FOREIGN KEY ("knowledge_space_id")
    REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("document_asset_id")
    REFERENCES "document_assets" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("parse_artifact_id")
    REFERENCES "parse_artifacts" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "knowledge_node_generation_receipts_document_idx"
  ON "knowledge_node_generation_receipts"
  ("knowledge_space_id", "document_asset_id", "publication_generation_id", "parse_artifact_id");
