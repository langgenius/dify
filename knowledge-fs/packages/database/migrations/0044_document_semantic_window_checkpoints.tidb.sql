-- Knowledge Platform schema migration
-- Migration id: 0044_document_semantic_window_checkpoints
-- Dialect: tidb
-- Persists validated semantic-window model responses for generation-scoped retry recovery.

CREATE TABLE IF NOT EXISTS `document_semantic_window_checkpoints` (
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_asset_id` CHAR(36) NOT NULL,
  `document_version` INT NOT NULL,
  `publication_generation_id` CHAR(36) NOT NULL,
  `window_id` VARCHAR(128) NOT NULL,
  `input_fingerprint` VARCHAR(71) NOT NULL,
  `model_fingerprint` VARCHAR(71) NOT NULL,
  `response_text` MEDIUMTEXT NOT NULL,
  `completion` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (
    `tenant_id`, `knowledge_space_id`, `publication_generation_id`,
    `window_id`, `input_fingerprint`
  ),
  CONSTRAINT `document_semantic_window_checkpoints_scope_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `document_semantic_window_checkpoints_asset_fk`
    FOREIGN KEY (`knowledge_space_id`, `document_asset_id`, `document_version`)
    REFERENCES `document_assets` (`knowledge_space_id`, `id`, `version`) ON DELETE CASCADE,
  CONSTRAINT `document_semantic_window_checkpoints_fingerprint_ck`
    CHECK (
      `input_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
      AND `model_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
    ),
  CONSTRAINT `document_semantic_window_checkpoints_completion_ck`
    CHECK (JSON_TYPE(`completion`) = 'OBJECT'),
  CONSTRAINT `document_semantic_window_checkpoints_version_ck`
    CHECK (`document_version` >= 1)
);

CREATE INDEX IF NOT EXISTS `document_semantic_window_checkpoints_asset_idx`
  ON `document_semantic_window_checkpoints` (
    `knowledge_space_id`, `document_asset_id`, `document_version`
  );
