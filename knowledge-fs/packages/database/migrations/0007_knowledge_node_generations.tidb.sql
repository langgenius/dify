-- Knowledge Platform schema migration
-- Migration id: 0007_knowledge_node_generations
-- Dialect: tidb

-- Knowledge nodes are immutable-build components. NULL remains the legacy publication scope;
-- non-NULL generations can be built and evaluated without mutating currently readable nodes.
-- TiDB requires v8.5+ with CHECK and foreign-key enforcement enabled, as verified by the runner.
ALTER TABLE `knowledge_nodes`
  ADD COLUMN IF NOT EXISTS `publication_generation_id` CHAR(36);
ALTER TABLE `knowledge_nodes`
  MODIFY COLUMN IF EXISTS `kind` VARCHAR(16) NOT NULL;
ALTER TABLE `knowledge_nodes`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
  GENERATED ALWAYS AS (
    COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
  ) VIRTUAL;

-- TiDB does not permit CHECK constraints to reference columns used by a foreign key referential
-- action. Candidate pair/checkpoint invariants remain transactionally enforced by the compilation
-- repository; PostgreSQL additionally keeps the database CHECK constraints.

-- The zero UUID is reserved only for mapping legacy NULL into the logical unique index. Adding the
-- constraint before enabling generation writers fails closed if historical data violates it.
ALTER TABLE `knowledge_nodes`
  ADD CONSTRAINT `knowledge_nodes_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (
      `publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000'
    )
  );

-- Retained generations must not amplify the two high-frequency node walks.
DROP INDEX IF EXISTS `knowledge_nodes_space_asset_kind_idx` ON `knowledge_nodes`;
CREATE INDEX IF NOT EXISTS `knowledge_nodes_space_asset_kind_idx`
  ON `knowledge_nodes` (
    `knowledge_space_id`,
    `publication_generation_id`,
    `document_asset_id`,
    `kind`,
    `id`
  );

DROP INDEX IF EXISTS `knowledge_nodes_artifact_offset_idx` ON `knowledge_nodes`;
CREATE INDEX IF NOT EXISTS `knowledge_nodes_artifact_offset_idx`
  ON `knowledge_nodes` (
    `knowledge_space_id`,
    `parse_artifact_id`,
    `publication_generation_id`,
    `start_offset`,
    `id`
  );

-- Do not delete or arbitrarily merge historical duplicates. Unique-index creation intentionally
-- aborts the migration so an operator can reconcile evidence-preserving node identity explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_nodes_artifact_kind_offsets_uq`
  ON `knowledge_nodes` (
    `knowledge_space_id`,
    `parse_artifact_id`,
    `kind`,
    `start_offset`,
    `end_offset`,
    `publication_generation_key`
  );
