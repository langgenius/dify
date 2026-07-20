-- Knowledge Platform schema migration
-- Migration id: 0005_publication_generation_nonzero
-- Dialect: tidb

-- The zero UUID is reserved exclusively as the unique-index sentinel for legacy NULL generations.
-- Fail closed if historical data has used it as an actual immutable build generation.
-- TiDB requires v7.2+ and tidb_enable_check_constraint=ON; keep that cluster-level feature enabled
-- so these constraints are enforced rather than weakening the publication boundary.
ALTER TABLE `index_projections`
  ADD CONSTRAINT `index_projections_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000')
  );
ALTER TABLE `document_outlines`
  ADD CONSTRAINT `document_outlines_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000')
  );
ALTER TABLE `document_multimodal_manifests`
  ADD CONSTRAINT `document_multimodal_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000')
  );
ALTER TABLE `knowledge_paths`
  ADD CONSTRAINT `knowledge_paths_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000')
  );
ALTER TABLE `graph_entities`
  ADD CONSTRAINT `graph_entities_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000')
  );
ALTER TABLE `graph_relations`
  ADD CONSTRAINT `graph_relations_pub_gen_nonzero_ck`
  CHECK (
    `publication_generation_id` IS NULL
    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000')
  );
ALTER TABLE `projection_set_publication_members`
  ADD CONSTRAINT `publication_members_gen_nonzero_ck`
  CHECK (`generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
    AND `generation_id` <> '00000000-0000-0000-0000-000000000000');
