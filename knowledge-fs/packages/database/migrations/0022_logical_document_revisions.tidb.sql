-- Knowledge Platform schema migration
-- Migration id: 0022_logical_document_revisions
-- Dialect: tidb
-- TiDB requires v8.5+ with CHECK and foreign-key enforcement enabled.

-- TiDB auto-commits each DDL statement. Only drop the legacy definition, and only add the new
-- definition when it is absent, so a crash between DROP and ADD remains replayable.
SET @kfs_0022_deletion_jobs_target_drop_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_jobs'
      AND constraint_name = 'deletion_jobs_target_ck'
      AND check_clause NOT LIKE '%logical_document%'
  ),
  'ALTER TABLE `deletion_jobs` DROP CHECK `deletion_jobs_target_ck`',
  'DO 0'
);
PREPARE kfs_0022_deletion_jobs_target_drop_stmt
  FROM @kfs_0022_deletion_jobs_target_drop_sql;
EXECUTE kfs_0022_deletion_jobs_target_drop_stmt;
DEALLOCATE PREPARE kfs_0022_deletion_jobs_target_drop_stmt;

SET @kfs_0022_deletion_jobs_target_add_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_jobs'
      AND constraint_name = 'deletion_jobs_target_ck'
  ),
  'DO 0',
  'ALTER TABLE `deletion_jobs` ADD CONSTRAINT `deletion_jobs_target_ck` CHECK (`target_type` IN (''knowledge_space'', ''source'', ''document_asset'', ''logical_document'') AND ((`target_type` = ''source'' AND `delete_mode` IN (''keep'', ''cascade'') AND `name_challenge_digest` IS NULL) OR (`target_type` = ''knowledge_space'' AND `delete_mode` = ''cascade'' AND `name_challenge_digest` IS NOT NULL) OR (`target_type` IN (''document_asset'', ''logical_document'') AND `delete_mode` = ''cascade'' AND `name_challenge_digest` IS NULL)))'
);
PREPARE kfs_0022_deletion_jobs_target_add_stmt
  FROM @kfs_0022_deletion_jobs_target_add_sql;
EXECUTE kfs_0022_deletion_jobs_target_add_stmt;
DEALLOCATE PREPARE kfs_0022_deletion_jobs_target_add_stmt;

SET @kfs_0022_deletion_tombstones_target_drop_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_tombstones'
      AND constraint_name = 'deletion_tombstones_target_ck'
      AND check_clause NOT LIKE '%logical_document%'
  ),
  'ALTER TABLE `deletion_tombstones` DROP CHECK `deletion_tombstones_target_ck`',
  'DO 0'
);
PREPARE kfs_0022_deletion_tombstones_target_drop_stmt
  FROM @kfs_0022_deletion_tombstones_target_drop_sql;
EXECUTE kfs_0022_deletion_tombstones_target_drop_stmt;
DEALLOCATE PREPARE kfs_0022_deletion_tombstones_target_drop_stmt;

SET @kfs_0022_deletion_tombstones_target_add_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_tombstones'
      AND constraint_name = 'deletion_tombstones_target_ck'
  ),
  'DO 0',
  'ALTER TABLE `deletion_tombstones` ADD CONSTRAINT `deletion_tombstones_target_ck` CHECK (`target_type` IN (''knowledge_space'', ''source'', ''document_asset'', ''logical_document''))'
);
PREPARE kfs_0022_deletion_tombstones_target_add_stmt
  FROM @kfs_0022_deletion_tombstones_target_add_sql;
EXECUTE kfs_0022_deletion_tombstones_target_add_stmt;
DEALLOCATE PREPARE kfs_0022_deletion_tombstones_target_add_stmt;

CREATE UNIQUE INDEX IF NOT EXISTS `sources_space_id_uq`
  ON `sources` (`knowledge_space_id`, `id`);

CREATE UNIQUE INDEX IF NOT EXISTS `document_compilation_attempts_scope_id_uq`
  ON `document_compilation_attempts` (`tenant_id`, `knowledge_space_id`, `id`);

CREATE TABLE IF NOT EXISTS `logical_documents` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `source_id` CHAR(36),
  `provider_item_id` VARCHAR(1024),
  `provider_item_digest` CHAR(64),
  `title` TEXT NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `deletion_job_id` CHAR(36),
  `deleting_at` DATETIME(3),
  `active_revision` INT,
  `row_version` INT NOT NULL,
  `system_metadata` JSON NOT NULL,
  `user_metadata` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE KEY `logical_documents_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`),
  CONSTRAINT `logical_documents_status_ck`
    CHECK (`status` IN ('pending', 'ready', 'failed', 'deleting')),
  CONSTRAINT `logical_documents_deletion_lifecycle_ck`
    CHECK (
      (`status` = 'deleting' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL)
      OR (`status` <> 'deleting' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL)
    ),
  CONSTRAINT `logical_documents_active_revision_ck`
    CHECK (`active_revision` IS NULL OR `active_revision` > 0),
  CONSTRAINT `logical_documents_row_version_ck` CHECK (`row_version` >= 0),
  CONSTRAINT `logical_documents_provider_identity_ck`
    CHECK (
      (
        `source_id` IS NULL
        AND `provider_item_id` IS NULL
        AND `provider_item_digest` IS NULL
      )
      OR (
        `source_id` IS NOT NULL
        AND `provider_item_id` IS NOT NULL
        AND `provider_item_digest` REGEXP '^[a-f0-9]{64}$'
      )
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `logical_documents_provider_item_uq`
  ON `logical_documents` (`provider_item_digest`);
CREATE INDEX IF NOT EXISTS `logical_documents_space_cursor_idx`
  ON `logical_documents` (`tenant_id`, `knowledge_space_id`, `created_at`, `id`);

CREATE TABLE IF NOT EXISTS `document_revisions` (
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `revision` INT NOT NULL,
  `document_asset_id` CHAR(36) NOT NULL,
  `document_asset_version` INT NOT NULL,
  `compilation_attempt_id` CHAR(36),
  `expected_active_revision` INT,
  `expected_document_row_version` INT NOT NULL,
  `content_hash` CHAR(64) NOT NULL,
  `mime_type` VARCHAR(255) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `system_metadata` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `activated_at` DATETIME(3),
  PRIMARY KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `revision`),
  CONSTRAINT `document_revisions_revision_ck` CHECK (`revision` > 0),
  CONSTRAINT `document_revisions_asset_version_ck` CHECK (`document_asset_version` > 0),
  CONSTRAINT `document_revisions_expected_active_ck`
    CHECK (`expected_active_revision` IS NULL OR `expected_active_revision` > 0),
  CONSTRAINT `document_revisions_expected_row_version_ck`
    CHECK (`expected_document_row_version` >= 0),
  CONSTRAINT `document_revisions_size_ck` CHECK (`size_bytes` >= 0),
  CONSTRAINT `document_revisions_hash_ck` CHECK (`content_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `document_revisions_state_ck`
    CHECK (`state` IN ('candidate', 'active', 'superseded', 'failed')),
  CONSTRAINT `document_revisions_activation_ck`
    CHECK (
      (`state` IN ('active', 'superseded') AND `activated_at` IS NOT NULL)
      OR (`state` IN ('candidate', 'failed') AND `activated_at` IS NULL)
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`)
    REFERENCES `logical_documents` (`tenant_id`, `knowledge_space_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`knowledge_space_id`, `document_asset_id`, `document_asset_version`)
    REFERENCES `document_assets` (`knowledge_space_id`, `id`, `version`)
);

CREATE INDEX IF NOT EXISTS `document_revisions_asset_idx`
  ON `document_revisions` (
    `tenant_id`,
    `knowledge_space_id`,
    `document_asset_id`,
    `document_asset_version`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `document_revisions_compilation_attempt_uq`
  ON `document_revisions` (`tenant_id`, `knowledge_space_id`, `compilation_attempt_id`);
CREATE INDEX IF NOT EXISTS `document_revisions_history_idx`
  ON `document_revisions` (`tenant_id`, `knowledge_space_id`, `document_id`, `revision`);

SET @logical_documents_active_revision_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'logical_documents'
    AND CONSTRAINT_NAME = 'logical_documents_active_revision_fk'
);
SET @logical_documents_active_revision_fk_sql = IF(
  @logical_documents_active_revision_fk_exists = 0,
  'ALTER TABLE `logical_documents` ADD CONSTRAINT `logical_documents_active_revision_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `id`, `active_revision`) REFERENCES `document_revisions` (`tenant_id`, `knowledge_space_id`, `document_id`, `revision`)',
  'SELECT 1'
);
PREPARE logical_documents_active_revision_fk_stmt FROM @logical_documents_active_revision_fk_sql;
EXECUTE logical_documents_active_revision_fk_stmt;
DEALLOCATE PREPARE logical_documents_active_revision_fk_stmt;

CREATE TABLE IF NOT EXISTS `document_revision_chunks` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `document_revision` INT NOT NULL,
  `parent_chunk_id` CHAR(36),
  `ordinal` INT NOT NULL,
  `token_count` INT NOT NULL,
  `text` TEXT NOT NULL,
  `system_metadata` JSON NOT NULL,
  `user_metadata` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  UNIQUE (`tenant_id`, `knowledge_space_id`, `document_id`, `document_revision`, `id`),
  CONSTRAINT `document_revision_chunks_ordinal_ck` CHECK (`ordinal` >= 0),
  CONSTRAINT `document_revision_chunks_tokens_ck` CHECK (`token_count` >= 0),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `document_revision`)
    REFERENCES `document_revisions` (
      `tenant_id`, `knowledge_space_id`, `document_id`, `revision`
    ) ON DELETE CASCADE,
  FOREIGN KEY (
    `tenant_id`,
    `knowledge_space_id`,
    `document_id`,
    `document_revision`,
    `parent_chunk_id`
  ) REFERENCES `document_revision_chunks` (
    `tenant_id`,
    `knowledge_space_id`,
    `document_id`,
    `document_revision`,
    `id`
  ) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `document_revision_chunks_ordinal_uq`
  ON `document_revision_chunks` (
    `tenant_id`, `knowledge_space_id`, `document_id`, `document_revision`, `ordinal`
  );
CREATE INDEX IF NOT EXISTS `document_revision_chunks_cursor_idx`
  ON `document_revision_chunks` (
    `tenant_id`, `knowledge_space_id`, `document_id`, `document_revision`, `id`
  );

CREATE TABLE IF NOT EXISTS `document_chunk_state_changes` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `document_revision` INT NOT NULL,
  `chunk_id` CHAR(36) NOT NULL,
  `enabled` BOOLEAN NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `compilation_attempt_id` CHAR(36) NOT NULL,
  `candidate_publication_id` CHAR(36),
  `candidate_fingerprint` VARCHAR(86),
  `created_at` DATETIME(3) NOT NULL,
  `activated_at` DATETIME(3),
  CONSTRAINT `document_chunk_state_changes_state_ck`
    CHECK (`state` IN ('candidate', 'active', 'superseded', 'failed')),
  CONSTRAINT `document_chunk_state_changes_activation_ck`
    CHECK (
      (`state` IN ('active', 'superseded') AND `activated_at` IS NOT NULL)
      OR (`state` IN ('candidate', 'failed') AND `activated_at` IS NULL)
    ),
  CONSTRAINT `document_chunk_state_changes_candidate_pair_ck`
    CHECK (
      (`candidate_publication_id` IS NULL AND `candidate_fingerprint` IS NULL)
      OR (`candidate_publication_id` IS NOT NULL AND `candidate_fingerprint` IS NOT NULL)
    ),
  FOREIGN KEY (
    `tenant_id`,
    `knowledge_space_id`,
    `document_id`,
    `document_revision`,
    `chunk_id`
  ) REFERENCES `document_revision_chunks` (
    `tenant_id`,
    `knowledge_space_id`,
    `document_id`,
    `document_revision`,
    `id`
  ) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `document_chunk_state_changes_candidate_uq`
  ON `document_chunk_state_changes` (
    `tenant_id`, `knowledge_space_id`, `document_id`, `document_revision`, `chunk_id`, `candidate_publication_id`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `document_chunk_state_changes_attempt_uq`
  ON `document_chunk_state_changes` (
    `tenant_id`, `knowledge_space_id`, `compilation_attempt_id`
  );
CREATE INDEX IF NOT EXISTS `document_chunk_state_changes_active_idx`
  ON `document_chunk_state_changes` (`chunk_id`, `state`, `activated_at`, `id`);

CREATE TABLE IF NOT EXISTS `document_settings_revisions` (
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `revision` INT NOT NULL,
  `settings` JSON NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `created_by_subject_id` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `activated_at` DATETIME(3),
  PRIMARY KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `revision`),
  CONSTRAINT `document_settings_revisions_revision_ck` CHECK (`revision` > 0),
  CONSTRAINT `document_settings_revisions_state_ck`
    CHECK (`state` IN ('candidate', 'active', 'superseded', 'failed')),
  CONSTRAINT `document_settings_revisions_activation_ck`
    CHECK (
      (`state` IN ('active', 'superseded') AND `activated_at` IS NOT NULL)
      OR (`state` IN ('candidate', 'failed') AND `activated_at` IS NULL)
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`)
    REFERENCES `logical_documents` (`tenant_id`, `knowledge_space_id`, `id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `document_settings_heads` (
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `active_revision` INT NOT NULL,
  `row_version` INT NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenant_id`, `knowledge_space_id`, `document_id`),
  CONSTRAINT `document_settings_heads_revision_ck` CHECK (`active_revision` > 0),
  CONSTRAINT `document_settings_heads_row_version_ck` CHECK (`row_version` >= 0),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `active_revision`)
    REFERENCES `document_settings_revisions` (
      `tenant_id`, `knowledge_space_id`, `document_id`, `revision`
    )
);

CREATE TABLE IF NOT EXISTS `document_reindex_attempts` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `document_revision` INT NOT NULL,
  `settings_revision` INT NOT NULL,
  `expected_settings_head_revision` INT NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `active_slot` INT,
  `compilation_attempt_id` CHAR(36) NOT NULL,
  `candidate_publication_id` CHAR(36),
  `candidate_fingerprint` VARCHAR(86),
  `row_version` INT NOT NULL,
  `error_code` VARCHAR(64),
  `error_message` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  CONSTRAINT `document_reindex_attempts_state_ck`
    CHECK (`state` IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT `document_reindex_attempts_active_slot_ck`
    CHECK (`active_slot` IS NULL OR `active_slot` = 1),
  CONSTRAINT `document_reindex_attempts_row_version_ck` CHECK (`row_version` >= 0),
  CONSTRAINT `document_reindex_attempts_expected_settings_head_revision_ck`
    CHECK (`expected_settings_head_revision` > 0),
  CONSTRAINT `document_reindex_attempts_lifecycle_ck`
    CHECK (
      (`state` IN ('queued', 'running') AND `active_slot` = 1 AND `completed_at` IS NULL)
      OR
      (`state` IN ('succeeded', 'failed', 'canceled') AND `active_slot` IS NULL AND `completed_at` IS NOT NULL)
    ),
  CONSTRAINT `document_reindex_attempts_candidate_pair_ck`
    CHECK (
      (`candidate_publication_id` IS NULL AND `candidate_fingerprint` IS NULL)
      OR
      (`candidate_publication_id` IS NOT NULL AND `candidate_fingerprint` IS NOT NULL)
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `document_revision`)
    REFERENCES `document_revisions` (
      `tenant_id`, `knowledge_space_id`, `document_id`, `revision`
    ) ON DELETE RESTRICT,
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `document_id`, `settings_revision`)
    REFERENCES `document_settings_revisions` (
      `tenant_id`, `knowledge_space_id`, `document_id`, `revision`
    ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `document_reindex_attempts_active_uq`
  ON `document_reindex_attempts` (`tenant_id`, `knowledge_space_id`, `document_id`, `active_slot`);
CREATE INDEX IF NOT EXISTS `document_reindex_attempts_cursor_idx`
  ON `document_reindex_attempts` (
    `tenant_id`, `knowledge_space_id`, `document_id`, `created_at`, `id`
  );
CREATE INDEX IF NOT EXISTS `document_compilation_attempts_space_cursor_idx`
  ON `document_compilation_attempts` (
    `tenant_id`, `knowledge_space_id`, `created_at`, `id`
  );

INSERT INTO `logical_documents` (
  `id`,
  `tenant_id`,
  `knowledge_space_id`,
  `source_id`,
  `provider_item_id`,
  `provider_item_digest`,
  `title`,
  `status`,
  `active_revision`,
  `row_version`,
  `system_metadata`,
  `user_metadata`,
  `created_at`,
  `updated_at`
)
SELECT
  asset.`id`,
  space.`tenant_id`,
  asset.`knowledge_space_id`,
  NULL,
  NULL,
  NULL,
  asset.`filename`,
  CASE
    WHEN asset.`parser_status` = 'parsed' THEN 'ready'
    WHEN asset.`parser_status` = 'failed' THEN 'failed'
    ELSE 'pending'
  END,
  NULL,
  0,
  JSON_OBJECT(
    'legacyDocumentAssetId', asset.`id`,
    'provenance', asset.`metadata`
  ),
  JSON_OBJECT(),
  asset.`created_at`,
  COALESCE(asset.`updated_at`, asset.`created_at`)
FROM `document_assets` asset
JOIN `knowledge_spaces` space ON space.`id` = asset.`knowledge_space_id`
ON DUPLICATE KEY UPDATE `id` = VALUES(`id`);

INSERT INTO `document_revisions` (
  `tenant_id`,
  `knowledge_space_id`,
  `document_id`,
  `revision`,
  `document_asset_id`,
  `document_asset_version`,
  `compilation_attempt_id`,
  `expected_active_revision`,
  `expected_document_row_version`,
  `content_hash`,
  `mime_type`,
  `size_bytes`,
  `state`,
  `system_metadata`,
  `created_at`,
  `activated_at`
)
SELECT
  space.`tenant_id`,
  asset.`knowledge_space_id`,
  asset.`id`,
  asset.`version`,
  asset.`id`,
  asset.`version`,
  NULL,
  NULL,
  0,
  asset.`sha256`,
  asset.`mime_type`,
  asset.`size_bytes`,
  'active',
  JSON_OBJECT('provenance', asset.`metadata`),
  asset.`created_at`,
  COALESCE(asset.`updated_at`, asset.`created_at`)
FROM `document_assets` asset
JOIN `knowledge_spaces` space ON space.`id` = asset.`knowledge_space_id`
ON DUPLICATE KEY UPDATE `revision` = VALUES(`revision`);

UPDATE `logical_documents` document
JOIN `document_assets` asset
  ON document.`id` = asset.`id`
  AND document.`knowledge_space_id` = asset.`knowledge_space_id`
SET
  document.`active_revision` = asset.`version`,
  document.`row_version` = document.`row_version` + 1
WHERE document.`active_revision` IS NULL;
