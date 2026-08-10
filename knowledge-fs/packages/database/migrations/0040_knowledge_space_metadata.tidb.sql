-- Knowledge Platform schema migration
-- Migration id: 0040_knowledge_space_metadata
-- Dialect: tidb
-- Adds a durable metadata-field catalog and document bindings without copying metadata values.

CREATE TABLE IF NOT EXISTS `knowledge_space_metadata_fields` (
  `id` CHAR(36) PRIMARY KEY,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `type` VARCHAR(16) NOT NULL,
  `row_version` INT NOT NULL DEFAULT 0,
  `created_by_subject_id` VARCHAR(255) NOT NULL,
  `updated_by_subject_id` VARCHAR(255),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `knowledge_space_metadata_fields_scope_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_space_metadata_fields_scope_id_uq`
    UNIQUE (`tenant_id`, `knowledge_space_id`, `id`),
  CONSTRAINT `knowledge_space_metadata_fields_name_uq`
    UNIQUE (`tenant_id`, `knowledge_space_id`, `name`),
  CONSTRAINT `knowledge_space_metadata_fields_type_ck`
    CHECK (`type` IN ('string', 'number', 'time')),
  CONSTRAINT `knowledge_space_metadata_fields_row_version_ck`
    CHECK (`row_version` >= 0)
);

CREATE INDEX IF NOT EXISTS `knowledge_space_metadata_fields_cursor_idx`
  ON `knowledge_space_metadata_fields` (`tenant_id`, `knowledge_space_id`, `name`, `id`);

CREATE TABLE IF NOT EXISTS `logical_document_metadata_bindings` (
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `metadata_field_id` CHAR(36) NOT NULL,
  `created_by_subject_id` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `metadata_field_id`),
  CONSTRAINT `logical_document_metadata_bindings_field_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `metadata_field_id`)
    REFERENCES `knowledge_space_metadata_fields` (`tenant_id`, `knowledge_space_id`, `id`)
    ON DELETE CASCADE,
  CONSTRAINT `logical_document_metadata_bindings_document_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`)
    REFERENCES `logical_documents` (`tenant_id`, `knowledge_space_id`, `id`)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `logical_document_metadata_bindings_field_idx`
  ON `logical_document_metadata_bindings`
  (`tenant_id`, `knowledge_space_id`, `metadata_field_id`, `document_id`);

INSERT IGNORE INTO `knowledge_space_metadata_fields` (
  `id`, `tenant_id`, `knowledge_space_id`, `name`, `type`, `row_version`,
  `created_by_subject_id`, `updated_by_subject_id`, `created_at`, `updated_at`
)
SELECT
  CONCAT(SUBSTRING(ranked.digest, 1, 8), '-', SUBSTRING(ranked.digest, 9, 4), '-5',
    SUBSTRING(ranked.digest, 14, 3), '-a', SUBSTRING(ranked.digest, 18, 3), '-',
    SUBSTRING(ranked.digest, 21, 12)),
  ranked.tenant_id, ranked.knowledge_space_id, ranked.name, ranked.metadata_type, 0,
  'migration:0040', NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
  SELECT
    valid_fields.*,
    ROW_NUMBER() OVER (
      PARTITION BY valid_fields.tenant_id, valid_fields.knowledge_space_id
      ORDER BY valid_fields.name
    ) AS field_rank
  FROM (
    SELECT
      grouped.tenant_id,
      grouped.knowledge_space_id,
      grouped.name,
      grouped.digest,
      MIN(grouped.metadata_type) AS metadata_type
    FROM (
      SELECT
        document.tenant_id,
        document.knowledge_space_id,
        metadata_key.name,
        MD5(CONCAT(document.tenant_id, ':', document.knowledge_space_id, ':', metadata_key.name)) AS digest,
        CASE
          WHEN JSON_TYPE(JSON_EXTRACT(document.user_metadata, CONCAT('$."', metadata_key.name, '"')))
            IN ('INTEGER', 'DOUBLE', 'DECIMAL') THEN 'number'
          WHEN JSON_TYPE(JSON_EXTRACT(document.user_metadata, CONCAT('$."', metadata_key.name, '"'))) = 'STRING'
            AND JSON_UNQUOTE(JSON_EXTRACT(document.user_metadata, CONCAT('$."', metadata_key.name, '"')))
              REGEXP '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$' THEN 'time'
          WHEN JSON_TYPE(JSON_EXTRACT(document.user_metadata, CONCAT('$."', metadata_key.name, '"'))) = 'STRING'
            THEN 'string'
          ELSE NULL
        END AS metadata_type
      FROM `logical_documents` document
      JOIN JSON_TABLE(
        JSON_KEYS(document.user_metadata),
        '$[*]' COLUMNS (`name` VARCHAR(255) PATH '$')
      ) metadata_key ON TRUE
      WHERE metadata_key.name REGEXP '^[a-z][a-z0-9_]{0,254}$'
        AND metadata_key.name NOT IN ('provenance', 'system')
        AND JSON_TYPE(JSON_EXTRACT(document.user_metadata, CONCAT('$."', metadata_key.name, '"'))) <> 'NULL'
    ) grouped
    GROUP BY grouped.tenant_id, grouped.knowledge_space_id, grouped.name, grouped.digest
    HAVING SUM(grouped.metadata_type IS NULL) = 0 AND COUNT(DISTINCT grouped.metadata_type) = 1
  ) valid_fields
) ranked
WHERE ranked.field_rank <= 100;

INSERT IGNORE INTO `logical_document_metadata_bindings` (
  `tenant_id`, `knowledge_space_id`, `document_id`, `metadata_field_id`,
  `created_by_subject_id`, `created_at`
)
SELECT
  document.tenant_id, document.knowledge_space_id, document.id, field.id,
  'migration:0040', CURRENT_TIMESTAMP(3)
FROM `logical_documents` document
JOIN `knowledge_space_metadata_fields` field
  ON field.tenant_id = document.tenant_id
  AND field.knowledge_space_id = document.knowledge_space_id
  AND JSON_CONTAINS_PATH(document.user_metadata, 'one', CONCAT('$."', field.name, '"')) = 1
  AND JSON_TYPE(JSON_EXTRACT(document.user_metadata, CONCAT('$."', field.name, '"'))) <> 'NULL';
