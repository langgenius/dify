-- Knowledge Platform schema migration
-- Migration id: 0043_semantic_generation_receipts
-- Dialect: tidb

CREATE TABLE IF NOT EXISTS `knowledge_node_generation_receipts` (
  `knowledge_space_id` CHAR(36) NOT NULL,
  `publication_generation_id` CHAR(36) NOT NULL,
  `parse_artifact_id` CHAR(36) NOT NULL,
  `document_asset_id` CHAR(36) NOT NULL,
  `artifact_hash` VARCHAR(64) NOT NULL,
  `document_chunk_count` INT NOT NULL,
  `stored_node_count` INT NOT NULL,
  `request_fingerprint` VARCHAR(71) NOT NULL,
  `response_fingerprint` VARCHAR(71) NOT NULL,
  `prompt_response_fingerprint` VARCHAR(71) NOT NULL,
  `receipt` JSON NOT NULL,
  PRIMARY KEY (`knowledge_space_id`, `publication_generation_id`, `parse_artifact_id`),
  CONSTRAINT `knowledge_node_generation_receipts_counts_ck` CHECK (
    `document_chunk_count` >= 0 AND `stored_node_count` >= 0
    AND `stored_node_count` <= `document_chunk_count`
  ),
  CONSTRAINT `knowledge_node_generation_receipts_hashes_ck` CHECK (
    `artifact_hash` REGEXP '^[a-f0-9]{64}$'
    AND `request_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
    AND `response_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
    AND `prompt_response_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT `knowledge_node_generation_receipts_json_ck`
    CHECK (JSON_TYPE(`receipt`) = 'OBJECT'),
  CONSTRAINT `knowledge_node_generation_receipts_bytes_ck`
    CHECK (OCTET_LENGTH(CAST(`receipt` AS CHAR)) <= 8388608),
  CONSTRAINT `knowledge_node_generation_receipts_pub_gen_nonzero_ck` CHECK (
    `publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
    AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000'
  ),
  FOREIGN KEY (`knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`document_asset_id`)
    REFERENCES `document_assets` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`parse_artifact_id`)
    REFERENCES `parse_artifacts` (`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `knowledge_node_generation_receipts_document_idx`
  ON `knowledge_node_generation_receipts`
  (`knowledge_space_id`, `document_asset_id`, `publication_generation_id`, `parse_artifact_id`);
