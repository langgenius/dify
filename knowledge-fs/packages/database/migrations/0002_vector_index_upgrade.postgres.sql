-- Knowledge Platform schema migration
-- Migration id: 0002_vector_index_upgrade
-- Dialect: postgres

-- Embedding dimensions are determined by the configured plugin model. Use typmod-free vector
-- columns so one deployment can store projections from multiple model-specific vector spaces.
-- Exact distance queries remain supported when they filter to the matching model. pgvector ANN
-- indexes require a fixed-dimensional cast plus the same model predicate and therefore cannot be
-- declared as one generic schema index.
ALTER TABLE "index_projections" ADD COLUMN IF NOT EXISTS "dense_vector" vector;
ALTER TABLE "index_projections" ADD COLUMN IF NOT EXISTS "visual_vector" vector;
ALTER TABLE "index_projections" ADD COLUMN IF NOT EXISTS "fts_document" tsvector;
ALTER TABLE "index_projections" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;

DROP INDEX IF EXISTS "index_projections_dense_vector_hnsw_idx";
DROP INDEX IF EXISTS "index_projections_visual_vector_hnsw_idx";
ALTER TABLE "index_projections"
  ALTER COLUMN "dense_vector" TYPE vector
  USING "dense_vector"::vector,
  ALTER COLUMN "visual_vector" TYPE vector
  USING "visual_vector"::vector;

-- Retry/redelivery in older releases could insert the same logical projection more than once.
-- Retain the lexicographically greatest UUID deterministically before enforcing idempotency.
DELETE FROM "index_projections" AS duplicate
USING "index_projections" AS keeper
WHERE duplicate."node_id" = keeper."node_id"
  AND duplicate."type" = keeper."type"
  AND duplicate."projection_version" = keeper."projection_version"
  AND COALESCE(duplicate."model", '') = COALESCE(keeper."model", '')
  AND duplicate."id" < keeper."id";
CREATE UNIQUE INDEX IF NOT EXISTS "index_projections_node_type_version_model_uq"
  ON "index_projections" (
    "node_id",
    "type",
    "projection_version",
    (COALESCE("model", ''))
  );

CREATE INDEX IF NOT EXISTS "index_projections_fts_document_idx"
  ON "index_projections" USING GIN ("fts_document");
