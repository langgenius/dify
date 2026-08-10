-- Knowledge Platform schema migration
-- Migration id: 0040_knowledge_space_metadata
-- Dialect: postgres
-- Adds a durable metadata-field catalog and document bindings without copying metadata values.

CREATE TABLE IF NOT EXISTS "knowledge_space_metadata_fields" (
  "id" UUID PRIMARY KEY,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "row_version" INTEGER NOT NULL DEFAULT 0,
  "created_by_subject_id" VARCHAR(255) NOT NULL,
  "updated_by_subject_id" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_metadata_fields_scope_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "knowledge_space_metadata_fields_scope_id_uq"
    UNIQUE ("tenant_id", "knowledge_space_id", "id"),
  CONSTRAINT "knowledge_space_metadata_fields_name_uq"
    UNIQUE ("tenant_id", "knowledge_space_id", "name"),
  CONSTRAINT "knowledge_space_metadata_fields_type_ck"
    CHECK ("type" IN ('string', 'number', 'time')),
  CONSTRAINT "knowledge_space_metadata_fields_row_version_ck"
    CHECK ("row_version" >= 0)
);

CREATE INDEX IF NOT EXISTS "knowledge_space_metadata_fields_cursor_idx"
  ON "knowledge_space_metadata_fields" ("tenant_id", "knowledge_space_id", "name", "id");

CREATE TABLE IF NOT EXISTS "logical_document_metadata_bindings" (
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "metadata_field_id" UUID NOT NULL,
  "created_by_subject_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("tenant_id", "knowledge_space_id", "document_id", "metadata_field_id"),
  CONSTRAINT "logical_document_metadata_bindings_field_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id", "metadata_field_id")
    REFERENCES "knowledge_space_metadata_fields" ("tenant_id", "knowledge_space_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "logical_document_metadata_bindings_document_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id", "document_id")
    REFERENCES "logical_documents" ("tenant_id", "knowledge_space_id", "id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "logical_document_metadata_bindings_field_idx"
  ON "logical_document_metadata_bindings"
  ("tenant_id", "knowledge_space_id", "metadata_field_id", "document_id");

-- Existing KnowledgeFS documents predate the field catalog. Only consistently typed, valid custom
-- names are admitted; mixed/object values remain in user_metadata but are not exposed as fields.
WITH metadata_values AS (
  SELECT
    document."tenant_id",
    document."knowledge_space_id",
    entry.key AS name,
    CASE
      WHEN jsonb_typeof(entry.value) = 'number' THEN 'number'
      WHEN jsonb_typeof(entry.value) = 'string'
        AND (entry.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
        THEN 'time'
      WHEN jsonb_typeof(entry.value) = 'string' THEN 'string'
      ELSE NULL
    END AS metadata_type
  FROM "logical_documents" document
  CROSS JOIN LATERAL jsonb_each(document."user_metadata") entry
  WHERE entry.key ~ '^[a-z][a-z0-9_]{0,254}$'
    AND entry.key NOT IN ('provenance', 'system')
    AND jsonb_typeof(entry.value) <> 'null'
), valid_fields AS (
  SELECT "tenant_id", "knowledge_space_id", name, MIN(metadata_type) AS metadata_type
  FROM metadata_values
  GROUP BY "tenant_id", "knowledge_space_id", name
  HAVING COUNT(*) FILTER (WHERE metadata_type IS NULL) = 0
    AND COUNT(DISTINCT metadata_type) = 1
), ranked_fields AS (
  SELECT
    "tenant_id",
    "knowledge_space_id",
    name,
    metadata_type,
    ROW_NUMBER() OVER (
      PARTITION BY "tenant_id", "knowledge_space_id"
      ORDER BY name
    ) AS field_rank
  FROM valid_fields
), deterministic_fields AS (
  SELECT
    "tenant_id",
    "knowledge_space_id",
    name,
    metadata_type,
    md5("tenant_id" || ':' || "knowledge_space_id"::text || ':' || name) AS digest
  FROM ranked_fields
  WHERE field_rank <= 100
)
INSERT INTO "knowledge_space_metadata_fields" (
  "id", "tenant_id", "knowledge_space_id", "name", "type", "row_version",
  "created_by_subject_id", "updated_by_subject_id", "created_at", "updated_at"
)
SELECT
  (substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-5' || substr(digest, 14, 3) ||
    '-a' || substr(digest, 18, 3) || '-' || substr(digest, 21, 12))::uuid,
  "tenant_id", "knowledge_space_id", name, metadata_type, 0,
  'migration:0040', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM deterministic_fields
ON CONFLICT ("tenant_id", "knowledge_space_id", "name") DO NOTHING;

INSERT INTO "logical_document_metadata_bindings" (
  "tenant_id", "knowledge_space_id", "document_id", "metadata_field_id",
  "created_by_subject_id", "created_at"
)
SELECT
  document."tenant_id", document."knowledge_space_id", document."id", field."id",
  'migration:0040', CURRENT_TIMESTAMP
FROM "logical_documents" document
JOIN "knowledge_space_metadata_fields" field
  ON field."tenant_id" = document."tenant_id"
  AND field."knowledge_space_id" = document."knowledge_space_id"
  AND document."user_metadata" ? field."name"
  AND jsonb_typeof(document."user_metadata" -> field."name") <> 'null'
ON CONFLICT DO NOTHING;
