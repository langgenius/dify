-- Knowledge Platform schema migration
-- Migration id: 0008_flattened_page_index
-- Dialect: postgres

CREATE TABLE IF NOT EXISTS "page_index_manifests" (
  "id" UUID PRIMARY KEY,
  "knowledge_space_id" UUID NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "document_outline_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "tokenizer_version" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "node_count" INTEGER NOT NULL,
  "term_count" INTEGER NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "page_index_manifests_space_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE,
  CONSTRAINT "page_index_manifests_outline_fk" FOREIGN KEY ("document_outline_id") REFERENCES "document_outlines" ("id") ON DELETE CASCADE,
  CONSTRAINT "page_index_manifests_generation_nonzero_ck" CHECK ("publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT "page_index_manifests_status_ck" CHECK ("status" IN ('building', 'ready')),
  CONSTRAINT "page_index_manifests_counts_ck" CHECK ("node_count" >= 0 AND "term_count" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "page_index_manifests_outline_generation_uq"
  ON "page_index_manifests" ("knowledge_space_id", "document_outline_id", "publication_generation_id");
CREATE INDEX IF NOT EXISTS "page_index_manifests_ready_scope_idx"
  ON "page_index_manifests" ("knowledge_space_id", "status", "document_outline_id", "publication_generation_id", "id");

CREATE TABLE IF NOT EXISTS "page_index_nodes" (
  "id" UUID PRIMARY KEY,
  "manifest_id" UUID NOT NULL,
  "outline_node_id" VARCHAR(512) NOT NULL,
  "parent_outline_node_id" VARCHAR(512),
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "section_path" JSONB NOT NULL,
  "visited_node_ids" JSONB NOT NULL,
  "level" INTEGER NOT NULL,
  "start_offset" INTEGER,
  "end_offset" INTEGER,
  "toc_source" VARCHAR(32) NOT NULL,
  CONSTRAINT "page_index_nodes_manifest_fk" FOREIGN KEY ("manifest_id") REFERENCES "page_index_manifests" ("id") ON DELETE CASCADE,
  CONSTRAINT "page_index_nodes_level_ck" CHECK ("level" > 0),
  CONSTRAINT "page_index_nodes_range_ck" CHECK ("start_offset" IS NULL OR "end_offset" IS NULL OR "end_offset" >= "start_offset")
);

CREATE UNIQUE INDEX IF NOT EXISTS "page_index_nodes_manifest_outline_node_uq"
  ON "page_index_nodes" ("manifest_id", "outline_node_id");
CREATE INDEX IF NOT EXISTS "page_index_nodes_manifest_id_idx"
  ON "page_index_nodes" ("manifest_id", "id");

CREATE TABLE IF NOT EXISTS "page_index_terms" (
  "id" UUID PRIMARY KEY,
  "knowledge_space_id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "page_index_node_id" UUID NOT NULL,
  "term" VARCHAR(128) NOT NULL,
  "field_mask" INTEGER NOT NULL,
  CONSTRAINT "page_index_terms_space_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE,
  CONSTRAINT "page_index_terms_manifest_fk" FOREIGN KEY ("manifest_id") REFERENCES "page_index_manifests" ("id") ON DELETE CASCADE,
  CONSTRAINT "page_index_terms_node_fk" FOREIGN KEY ("page_index_node_id") REFERENCES "page_index_nodes" ("id") ON DELETE CASCADE,
  CONSTRAINT "page_index_terms_field_mask_ck" CHECK ("field_mask" BETWEEN 1 AND 7)
);

CREATE UNIQUE INDEX IF NOT EXISTS "page_index_terms_manifest_node_term_uq"
  ON "page_index_terms" ("manifest_id", "page_index_node_id", "term");
CREATE INDEX IF NOT EXISTS "page_index_terms_exact_lookup_idx"
  ON "page_index_terms" ("knowledge_space_id", "term", "page_index_node_id", "manifest_id", "field_mask");
CREATE INDEX IF NOT EXISTS "page_index_terms_manifest_lookup_idx"
  ON "page_index_terms" ("knowledge_space_id", "manifest_id", "term", "page_index_node_id", "field_mask");
