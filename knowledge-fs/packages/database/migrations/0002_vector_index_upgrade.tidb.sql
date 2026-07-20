-- Knowledge Platform schema migration
-- Migration id: 0002_vector_index_upgrade
-- Dialect: tidb

-- Embedding dimensions are determined by the configured plugin model. TiDB's unbounded VECTOR
-- type can store projections from multiple model-specific vector spaces. It cannot have a vector
-- index, so retain exact model-filtered distance search unless a deployment separates a concrete
-- model into a fixed-dimensional indexed column/table backed by TiFlash.
DROP INDEX IF EXISTS `index_projections_dense_vector_hnsw_idx` ON `index_projections`;
DROP INDEX IF EXISTS `index_projections_visual_vector_hnsw_idx` ON `index_projections`;

ALTER TABLE `index_projections` ADD COLUMN IF NOT EXISTS `dense_vector` VECTOR;
ALTER TABLE `index_projections` ADD COLUMN IF NOT EXISTS `visual_vector` VECTOR;
ALTER TABLE `index_projections` ADD COLUMN IF NOT EXISTS `fts_document` TEXT;
ALTER TABLE `index_projections` ADD COLUMN IF NOT EXISTS `updated_at` DATETIME(3);
ALTER TABLE `index_projections`
  ADD COLUMN IF NOT EXISTS `model_key` VARCHAR(255)
  GENERATED ALWAYS AS (COALESCE(`model`, '')) VIRTUAL;
ALTER TABLE `index_projections` MODIFY COLUMN IF EXISTS `dense_vector` VECTOR;
ALTER TABLE `index_projections` MODIFY COLUMN IF EXISTS `visual_vector` VECTOR;

DELETE duplicate FROM `index_projections` AS duplicate
INNER JOIN `index_projections` AS keeper
  ON duplicate.`node_id` = keeper.`node_id`
  AND duplicate.`type` = keeper.`type`
  AND duplicate.`projection_version` = keeper.`projection_version`
  AND COALESCE(duplicate.`model`, '') = COALESCE(keeper.`model`, '')
  AND duplicate.`id` < keeper.`id`;
CREATE UNIQUE INDEX IF NOT EXISTS `index_projections_node_type_version_model_uq`
  ON `index_projections` (
    `node_id`,
    `type`,
    `projection_version`,
    `model_key`
  );

-- TiDB v8.5 does not implement FULLTEXT indexes or FTS_MATCH_WORD. Migration 0011 cuts TiDB
-- retrieval over to bounded, publication-scoped indexed postings; PostgreSQL keeps its native
-- GIN tsvector index. Do not emit unsupported FULLTEXT DDL here.
