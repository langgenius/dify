-- Knowledge Platform schema migration
-- Migration id: 0003_projection_set_publications
-- Dialect: postgres

-- A publication is an immutable, tenant-scoped candidate generation. The mutable head lives in a
-- separate row so publication is one compare-and-swap instead of a sequence of visible row flips.
CREATE TABLE IF NOT EXISTS "projection_set_publications" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "fingerprint" VARCHAR(86) NOT NULL,
  "projection_version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "superseded_by_fingerprint" VARCHAR(86),
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publications_space_fingerprint_uq"
  ON "projection_set_publications" ("tenant_id", "knowledge_space_id", "fingerprint");
CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publications_space_id_uq"
  ON "projection_set_publications" ("tenant_id", "knowledge_space_id", "id");
CREATE INDEX IF NOT EXISTS "projection_set_publications_space_status_updated_idx"
  ON "projection_set_publications" (
    "tenant_id",
    "knowledge_space_id",
    "status",
    "updated_at",
    "fingerprint",
    "id"
  );

CREATE TABLE IF NOT EXISTS "projection_set_publication_heads" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "publication_id" UUID NOT NULL,
  "head_revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id", "knowledge_space_id", "publication_id")
    REFERENCES "projection_set_publications" ("tenant_id", "knowledge_space_id", "id")
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publication_heads_space_uq"
  ON "projection_set_publication_heads" ("tenant_id", "knowledge_space_id");
CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publication_heads_publication_uq"
  ON "projection_set_publication_heads" ("publication_id");
