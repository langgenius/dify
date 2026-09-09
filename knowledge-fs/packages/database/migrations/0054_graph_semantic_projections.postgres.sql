-- Knowledge Platform schema migration
-- Migration id: 0054_graph_semantic_projections
-- Dialect: postgres
-- Additive, graph-only semantic indexes. Existing publications remain readable without vectors.
-- Owner deletion cascades to projections; vectors never grant independent read permissions.

CREATE TABLE IF NOT EXISTS "graph_entity_semantic_projections" (
  "owner_id" UUID NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "vector_space_id" VARCHAR(87) NOT NULL,
  "dimension" INTEGER NOT NULL,
  "representation_version" VARCHAR(64) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "search_text" TEXT NOT NULL,
  "vector" vector NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("owner_id", "vector_space_id"),
  FOREIGN KEY ("owner_id") REFERENCES "graph_entities" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "graph_entity_semantic_scope_idx"
  ON "graph_entity_semantic_projections" ("knowledge_space_id", "vector_space_id", "publication_generation_id", "owner_id");

CREATE TABLE IF NOT EXISTS "graph_relation_semantic_projections" (
  "owner_id" UUID NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "vector_space_id" VARCHAR(87) NOT NULL,
  "dimension" INTEGER NOT NULL,
  "representation_version" VARCHAR(64) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "search_text" TEXT NOT NULL,
  "vector" vector NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("owner_id", "vector_space_id"),
  FOREIGN KEY ("owner_id") REFERENCES "graph_relations" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "graph_relation_semantic_scope_idx"
  ON "graph_relation_semantic_projections" ("knowledge_space_id", "vector_space_id", "publication_generation_id", "owner_id");
