-- Knowledge Platform schema migration
-- Migration id: 0004_projection_publication_members
-- Dialect: postgres

-- Derived rows belong to immutable build generations. Nullable columns keep this an expand-safe
-- migration for legacy writers; the zero UUID in logical unique indexes treats legacy NULL rows as
-- one generation, preserving their previous retry/idempotency behavior.
ALTER TABLE "index_projections"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;
ALTER TABLE "document_outlines"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;
ALTER TABLE "document_multimodal_manifests"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;
ALTER TABLE "knowledge_paths"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;
ALTER TABLE "graph_entities"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;
ALTER TABLE "graph_relations"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;

-- Generation-scoped readers filter immediately after tenant-space scope. Rebuild the existing
-- access-path indexes so retained historical generations do not amplify candidate/read scans.
DROP INDEX IF EXISTS "index_projections_space_type_status_idx";
CREATE INDEX IF NOT EXISTS "index_projections_space_type_status_idx"
  ON "index_projections" (
    "knowledge_space_id",
    "publication_generation_id",
    "type",
    "status",
    "node_id",
    "id"
  );
DROP INDEX IF EXISTS "knowledge_paths_space_view_path_idx";
CREATE INDEX IF NOT EXISTS "knowledge_paths_space_view_path_idx"
  ON "knowledge_paths" (
    "knowledge_space_id",
    "publication_generation_id",
    "view_type",
    "view_name",
    "virtual_path",
    "id"
  );
DROP INDEX IF EXISTS "graph_entities_space_type_name_idx";
CREATE INDEX IF NOT EXISTS "graph_entities_space_type_name_idx"
  ON "graph_entities" (
    "knowledge_space_id",
    "publication_generation_id",
    "type",
    "name",
    "id"
  );
DROP INDEX IF EXISTS "graph_relations_subject_traversal_idx";
CREATE INDEX IF NOT EXISTS "graph_relations_subject_traversal_idx"
  ON "graph_relations" (
    "knowledge_space_id",
    "publication_generation_id",
    "subject_entity_id",
    "type",
    "object_entity_id",
    "id"
  );
DROP INDEX IF EXISTS "graph_relations_object_traversal_idx";
CREATE INDEX IF NOT EXISTS "graph_relations_object_traversal_idx"
  ON "graph_relations" (
    "knowledge_space_id",
    "publication_generation_id",
    "object_entity_id",
    "type",
    "subject_entity_id",
    "id"
  );

DROP INDEX IF EXISTS "document_multimodal_manifests_asset_version_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "document_multimodal_manifests_asset_version_uq"
  ON "document_multimodal_manifests" (
    "document_asset_id",
    "version",
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

DROP INDEX IF EXISTS "index_projections_node_type_version_model_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "index_projections_node_type_version_model_uq"
  ON "index_projections" (
    "node_id",
    "type",
    "projection_version",
    (COALESCE("model", '')),
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

DROP INDEX IF EXISTS "knowledge_paths_space_path_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_paths_space_path_uq"
  ON "knowledge_paths" (
    "knowledge_space_id",
    "virtual_path",
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

DROP INDEX IF EXISTS "graph_entities_space_key_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "graph_entities_space_key_uq"
  ON "graph_entities" (
    "knowledge_space_id",
    "canonical_key",
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- These tables previously relied on keyed overwrite/deterministic IDs rather than database
-- logical uniqueness. If legacy duplicates exist, unique-index creation intentionally fails
-- closed: deleting an arbitrary Graph relation could lose evidence or weaken permission scope.
CREATE UNIQUE INDEX IF NOT EXISTS "graph_relations_space_edge_version_uq"
  ON "graph_relations" (
    "knowledge_space_id",
    "subject_entity_id",
    "type",
    "object_entity_id",
    "extraction_version",
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "document_outlines_asset_version_uq"
  ON "document_outlines" (
    "document_asset_id",
    "version",
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- component_key is the UUID of a derived row under component_type, not a free-form logical path.
-- A publication may retain components from several generations when only one document changes.
CREATE TABLE IF NOT EXISTS "projection_set_publication_members" (
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "publication_id" UUID NOT NULL,
  "component_type" VARCHAR(64) NOT NULL,
  "component_key" UUID NOT NULL,
  "generation_id" UUID NOT NULL,
  "document_asset_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL,
  FOREIGN KEY ("tenant_id", "knowledge_space_id", "publication_id")
    REFERENCES "projection_set_publications" ("tenant_id", "knowledge_space_id", "id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publication_members_component_uq"
  ON "projection_set_publication_members" ("publication_id", "component_type", "component_key");
CREATE INDEX IF NOT EXISTS "projection_set_publication_members_generation_idx"
  ON "projection_set_publication_members" (
    "tenant_id",
    "knowledge_space_id",
    "generation_id",
    "publication_id",
    "component_type",
    "component_key"
  );
CREATE INDEX IF NOT EXISTS "projection_set_publication_members_document_idx"
  ON "projection_set_publication_members" (
    "tenant_id",
    "knowledge_space_id",
    "publication_id",
    "document_asset_id",
    "component_type",
    "component_key"
  );
