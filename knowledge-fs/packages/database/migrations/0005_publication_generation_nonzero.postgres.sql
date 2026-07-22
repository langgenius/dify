-- Knowledge Platform schema migration
-- Migration id: 0005_publication_generation_nonzero
-- Dialect: postgres

-- The zero UUID is reserved exclusively as the unique-index sentinel for legacy NULL generations.
-- Fail closed if historical data has used it as an actual immutable build generation.
ALTER TABLE "index_projections"
  ADD CONSTRAINT "index_projections_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );
ALTER TABLE "document_outlines"
  ADD CONSTRAINT "document_outlines_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );
ALTER TABLE "document_multimodal_manifests"
  ADD CONSTRAINT "document_multimodal_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );
ALTER TABLE "knowledge_paths"
  ADD CONSTRAINT "knowledge_paths_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );
ALTER TABLE "graph_entities"
  ADD CONSTRAINT "graph_entities_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );
ALTER TABLE "graph_relations"
  ADD CONSTRAINT "graph_relations_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );
ALTER TABLE "projection_set_publication_members"
  ADD CONSTRAINT "publication_members_gen_nonzero_ck"
  CHECK ("generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid);
