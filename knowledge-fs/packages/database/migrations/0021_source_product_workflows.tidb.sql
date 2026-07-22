-- Knowledge Platform schema migration
-- Migration id: 0021_source_product_workflows
-- Dialect: tidb

CREATE TABLE IF NOT EXISTS `source_connections` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `provider_id` VARCHAR(128) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `auth_kind` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `configuration` JSON NOT NULL,
  `credential_ref` VARCHAR(255),
  `scopes` JSON NOT NULL,
  `expires_at` DATETIME(3),
  `last_error_code` VARCHAR(64),
  `version` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `source_connections_auth_kind_ck`
    CHECK (`auth_kind` IN ('api-key', 'endpoint', 'oauth2')),
  CONSTRAINT `source_connections_status_ck`
    CHECK (`status` IN ('provisioning', 'active', 'expired', 'error', 'revoked')),
  CONSTRAINT `source_connections_version_ck` CHECK (`version` >= 1),
  CONSTRAINT `source_connections_secret_ck` CHECK (
    (`status` = 'revoked' AND `credential_ref` IS NULL) OR `status` <> 'revoked'
  ),
  UNIQUE KEY `source_connections_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`),
  UNIQUE KEY `source_connections_space_id_uq` (`knowledge_space_id`, `id`),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_connections_scope_id_uq`
  ON `source_connections` (`tenant_id`, `knowledge_space_id`, `id`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_connections_space_id_uq`
  ON `source_connections` (`knowledge_space_id`, `id`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_connections_credential_ref_uq`
  ON `source_connections` (`credential_ref`);
CREATE INDEX IF NOT EXISTS `source_connections_scope_status_idx`
  ON `source_connections` (`tenant_id`, `knowledge_space_id`, `status`, `created_at`, `id`);

CREATE TABLE IF NOT EXISTS `source_oauth_transactions` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `connection_id` CHAR(36) NOT NULL,
  `requested_by_subject_id` VARCHAR(255) NOT NULL,
  `access_channel` VARCHAR(16) NOT NULL,
  `permission_snapshot_id` CHAR(36) NOT NULL,
  `permission_snapshot_revision` INT NOT NULL,
  `api_key_id` CHAR(36),
  `state_hash` CHAR(64) NOT NULL,
  `verifier_ref` VARCHAR(255) NOT NULL,
  `redirect_uri` VARCHAR(2048) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3),
  `completed_at` DATETIME(3),
  CONSTRAINT `source_oauth_transactions_state_hash_ck`
    CHECK (`state_hash` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `source_oauth_transactions_status_ck`
    CHECK (`status` IN ('pending', 'exchanging', 'completed', 'failed')),
  CONSTRAINT `source_oauth_transactions_channel_ck`
    CHECK (`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')),
  CONSTRAINT `source_oauth_transactions_permission_ck`
    CHECK (`permission_snapshot_revision` >= 1),
  CONSTRAINT `source_oauth_transactions_lifecycle_ck` CHECK (
    (`status` = 'pending' AND `consumed_at` IS NULL AND `completed_at` IS NULL)
    OR (`status` IN ('exchanging', 'failed') AND `consumed_at` IS NOT NULL)
    OR (`status` = 'completed' AND `consumed_at` IS NOT NULL AND `completed_at` IS NOT NULL)
  ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `connection_id`)
    REFERENCES `source_connections` (`tenant_id`, `knowledge_space_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `permission_snapshot_id`,
    `requested_by_subject_id`, `access_channel`
  ) REFERENCES `knowledge_space_permission_snapshots` (
    `tenant_id`, `knowledge_space_id`, `id`, `subject_id`, `access_channel`
  ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `api_key_id`)
    REFERENCES `knowledge_space_api_keys` (`tenant_id`, `knowledge_space_id`, `id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_oauth_transactions_state_hash_uq`
  ON `source_oauth_transactions` (`state_hash`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_oauth_transactions_verifier_ref_uq`
  ON `source_oauth_transactions` (`verifier_ref`);
CREATE INDEX IF NOT EXISTS `source_oauth_transactions_expiry_idx`
  ON `source_oauth_transactions` (`status`, `expires_at`, `id`);

CREATE TABLE IF NOT EXISTS `source_connection_secret_refs` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `connection_id` CHAR(36) NOT NULL,
  `provider_id` VARCHAR(128) NOT NULL,
  `credential_ref` VARCHAR(255) NOT NULL,
  `purpose` VARCHAR(32) NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `remote_revoke_required` BOOLEAN NOT NULL,
  `recover_after` DATETIME(3) NOT NULL,
  `next_attempt_at` DATETIME(3),
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `row_version` INT NOT NULL,
  `last_error_code` VARCHAR(64),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3),
  CONSTRAINT `source_connection_secret_refs_purpose_ck`
    CHECK (`purpose` IN ('connection-credential', 'oauth-pkce')),
  CONSTRAINT `source_connection_secret_refs_state_ck`
    CHECK (`state` IN ('staged', 'active', 'retired', 'deleting', 'deleted')),
  CONSTRAINT `source_connection_secret_refs_version_ck` CHECK (`row_version` >= 1),
  CONSTRAINT `source_connection_secret_refs_lease_ck` CHECK (
    (`state` = 'deleting' AND `worker_id` IS NOT NULL
      AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL)
    OR (`state` <> 'deleting' AND `worker_id` IS NULL
      AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)
  ),
  CONSTRAINT `source_connection_secret_refs_terminal_ck` CHECK (
    (`state` = 'deleted' AND `deleted_at` IS NOT NULL)
    OR (`state` <> 'deleted' AND `deleted_at` IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_connection_secret_refs_ref_uq`
  ON `source_connection_secret_refs` (`credential_ref`);
CREATE INDEX IF NOT EXISTS `source_connection_secret_refs_claim_idx`
  ON `source_connection_secret_refs` (`state`, `next_attempt_at`, `recover_after`, `lease_expires_at`, `id`);
CREATE INDEX IF NOT EXISTS `source_connection_secret_refs_scope_idx`
  ON `source_connection_secret_refs` (`tenant_id`, `knowledge_space_id`, `connection_id`, `state`, `id`);

ALTER TABLE `sources` ADD COLUMN IF NOT EXISTS `connection_id` CHAR(36);
SET @source_connection_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'sources'
    AND constraint_name = 'sources_connection_fk'
);
SET @source_connection_fk_ddl = IF(
  @source_connection_fk_exists = 0,
  'ALTER TABLE `sources` ADD CONSTRAINT `sources_connection_fk` FOREIGN KEY (`knowledge_space_id`, `connection_id`) REFERENCES `source_connections` (`knowledge_space_id`, `id`) ON DELETE RESTRICT',
  'DO 0'
);
PREPARE source_connection_fk_statement FROM @source_connection_fk_ddl;
EXECUTE source_connection_fk_statement;
DEALLOCATE PREPARE source_connection_fk_statement;
CREATE INDEX IF NOT EXISTS `sources_connection_idx`
  ON `sources` (`knowledge_space_id`, `connection_id`, `id`);

CREATE TABLE IF NOT EXISTS `source_sync_policies` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `source_id` CHAR(36) NOT NULL,
  `requested_by_subject_id` VARCHAR(255) NOT NULL,
  `access_channel` VARCHAR(16) NOT NULL,
  `permission_snapshot_id` CHAR(36) NOT NULL,
  `permission_snapshot_revision` INT NOT NULL,
  `required_permission_scope` JSON NOT NULL,
  `mode` VARCHAR(16) NOT NULL,
  `enabled` BOOLEAN NOT NULL,
  `custom_interval_seconds` INT,
  `next_run_at` DATETIME(3),
  `expected_source_version` INT NOT NULL,
  `revision` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `source_sync_policies_mode_ck`
    CHECK (`mode` IN ('provider', 'manual', 'interval', 'custom')),
  CONSTRAINT `source_sync_policies_channel_ck`
    CHECK (`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')),
  CONSTRAINT `source_sync_policies_interval_ck` CHECK (
    (`mode` = 'custom' AND `custom_interval_seconds` BETWEEN 3600 AND 2592000)
    OR (`mode` <> 'custom' AND `custom_interval_seconds` IS NULL)
  ),
  CONSTRAINT `source_sync_policies_revision_ck`
    CHECK (
      `revision` >= 1 AND `expected_source_version` >= 1
      AND `permission_snapshot_revision` >= 1
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`knowledge_space_id`, `source_id`)
    REFERENCES `sources` (`knowledge_space_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `permission_snapshot_id`,
    `requested_by_subject_id`, `access_channel`
  ) REFERENCES `knowledge_space_permission_snapshots` (
    `tenant_id`, `knowledge_space_id`, `id`, `subject_id`, `access_channel`
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_sync_policies_source_uq`
  ON `source_sync_policies` (`tenant_id`, `knowledge_space_id`, `source_id`);
CREATE INDEX IF NOT EXISTS `source_sync_policies_due_idx`
  ON `source_sync_policies` (`enabled`, `next_run_at`, `id`);

CREATE TABLE IF NOT EXISTS `source_workflow_runs` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `source_id` CHAR(36),
  `source_scope` VARCHAR(128) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `run_state` VARCHAR(24) NOT NULL,
  `checkpoint` VARCHAR(32) NOT NULL,
  `payload` JSON NOT NULL,
  `cursor` VARCHAR(4096),
  `progress_total` INT,
  `progress_completed` INT NOT NULL,
  `progress_skipped` INT NOT NULL,
  `progress_failed` INT NOT NULL,
  `permission_snapshot_id` CHAR(36) NOT NULL,
  `permission_snapshot_revision` INT NOT NULL,
  `requested_by_subject_id` VARCHAR(255) NOT NULL,
  `required_permission_scope` JSON NOT NULL,
  `access_channel` VARCHAR(16) NOT NULL,
  `idempotency_key` VARCHAR(255) NOT NULL,
  `idempotency_digest` CHAR(64) NOT NULL,
  `execution_attempts` INT NOT NULL,
  `max_execution_attempts` INT NOT NULL,
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `row_version` INT NOT NULL,
  `active_slot` INT,
  `last_error_code` VARCHAR(64),
  `last_error_message` VARCHAR(1000),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  `canceled_at` DATETIME(3),
  CONSTRAINT `source_workflow_runs_idempotency_digest_ck`
    CHECK (`idempotency_digest` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `source_workflow_runs_kind_ck` CHECK (
    `kind` IN ('crawl-preview', 'crawl-import', 'online-document-import', 'online-drive-import', 'sync', 'bulk')
  ),
  CONSTRAINT `source_workflow_runs_state_ck` CHECK (
    `run_state` IN ('queued', 'running', 'crawling', 'preview_ready', 'importing', 'syncing', 'completed', 'zero_results', 'failed', 'canceled')
  ),
  CONSTRAINT `source_workflow_runs_checkpoint_ck` CHECK (
    `checkpoint` IN ('queued', 'provider-read', 'preview-staged', 'selection-frozen', 'materialized', 'cleanup-staging', 'source-committed')
  ),
  CONSTRAINT `source_workflow_runs_nonnegative_ck` CHECK (
    (`progress_total` IS NULL OR `progress_total` >= 0)
    AND (`progress_total` IS NULL OR
      `progress_completed` + `progress_skipped` + `progress_failed` <= `progress_total`)
    AND `progress_completed` >= 0 AND `progress_skipped` >= 0 AND `progress_failed` >= 0
    AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1
    AND `execution_attempts` <= `max_execution_attempts`
    AND `permission_snapshot_revision` >= 1 AND `row_version` >= 1
    AND (`active_slot` IS NULL OR `active_slot` = 1)
  ),
  CONSTRAINT `source_workflow_runs_lease_ck` CHECK (
    (`run_state` IN ('running', 'crawling', 'importing', 'syncing')
      AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL)
    OR (`run_state` NOT IN ('running', 'crawling', 'importing', 'syncing')
      AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)
  ),
  CONSTRAINT `source_workflow_runs_terminal_ck` CHECK (
    (`run_state` IN ('queued', 'running', 'crawling', 'preview_ready', 'importing', 'syncing')
      AND `active_slot` = 1 AND `completed_at` IS NULL)
    OR (`run_state` IN ('completed', 'zero_results', 'failed')
      AND `active_slot` IS NULL AND `completed_at` IS NOT NULL AND `canceled_at` IS NULL)
    OR (`run_state` = 'canceled' AND `active_slot` IS NULL
      AND `completed_at` IS NOT NULL AND `canceled_at` IS NOT NULL)
  ),
  UNIQUE KEY `source_workflow_runs_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`knowledge_space_id`, `source_id`)
    REFERENCES `sources` (`knowledge_space_id`, `id`) ON DELETE RESTRICT,
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `permission_snapshot_id`, `requested_by_subject_id`, `access_channel`)
    REFERENCES `knowledge_space_permission_snapshots` (`tenant_id`, `knowledge_space_id`, `id`, `subject_id`, `access_channel`)
    ON DELETE RESTRICT
);

-- Recover a table left behind when the former 3204-byte composite index exceeded TiDB's
-- 3072-byte limit. Retain idempotency_key and verify it after digest lookup for collision safety.
ALTER TABLE `source_workflow_runs`
  ADD COLUMN IF NOT EXISTS `idempotency_digest` CHAR(64);
UPDATE `source_workflow_runs`
SET `idempotency_digest` = SHA2(CONCAT(
  'v1|', OCTET_LENGTH(`tenant_id`), ':', `tenant_id`, '|',
  OCTET_LENGTH(`knowledge_space_id`), ':', `knowledge_space_id`, '|',
  OCTET_LENGTH(`requested_by_subject_id`), ':', `requested_by_subject_id`, '|',
  OCTET_LENGTH(`idempotency_key`), ':', `idempotency_key`, '|'
), 256)
WHERE `idempotency_digest` IS NULL;
ALTER TABLE `source_workflow_runs`
  MODIFY COLUMN `idempotency_digest` CHAR(64) NOT NULL;

DROP INDEX IF EXISTS `source_workflow_runs_idempotency_uq` ON `source_workflow_runs`;
CREATE UNIQUE INDEX IF NOT EXISTS `source_workflow_runs_idempotency_digest_uq`
  ON `source_workflow_runs` (`idempotency_digest`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_workflow_runs_scope_id_uq`
  ON `source_workflow_runs` (`tenant_id`, `knowledge_space_id`, `id`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_workflow_runs_active_uq`
  ON `source_workflow_runs` (`tenant_id`, `knowledge_space_id`, `source_scope`, `active_slot`);
CREATE INDEX IF NOT EXISTS `source_workflow_runs_claim_idx`
  ON `source_workflow_runs` (`run_state`, `lease_expires_at`, `updated_at`, `id`);
CREATE INDEX IF NOT EXISTS `source_workflow_runs_history_idx`
  ON `source_workflow_runs` (`tenant_id`, `knowledge_space_id`, `source_id`, `created_at`, `id`);

CREATE TABLE IF NOT EXISTS `source_workflow_outbox` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `delivery_revision` INT NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `available_at` DATETIME(3) NOT NULL,
  `locked_by` VARCHAR(255),
  `lock_token` CHAR(36),
  `locked_until` DATETIME(3),
  `last_error` VARCHAR(1000),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `delivered_at` DATETIME(3),
  CONSTRAINT `source_workflow_outbox_status_ck`
    CHECK (`status` IN ('pending', 'leased', 'completed', 'canceled')),
  CONSTRAINT `source_workflow_outbox_revision_ck` CHECK (`delivery_revision` >= 1),
  CONSTRAINT `source_workflow_outbox_lease_ck` CHECK (
    (`status` = 'leased' AND `locked_by` IS NOT NULL AND `lock_token` IS NOT NULL AND `locked_until` IS NOT NULL)
    OR (`status` <> 'leased' AND `locked_by` IS NULL AND `lock_token` IS NULL AND `locked_until` IS NULL)
  ),
  FOREIGN KEY (`run_id`) REFERENCES `source_workflow_runs` (`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_workflow_outbox_delivery_uq`
  ON `source_workflow_outbox` (`run_id`, `delivery_revision`);
CREATE INDEX IF NOT EXISTS `source_workflow_outbox_claim_idx`
  ON `source_workflow_outbox` (`status`, `available_at`, `locked_until`, `id`);

CREATE TABLE IF NOT EXISTS `source_crawl_preview_pages` (
  `id` CHAR(64) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `page_id` CHAR(64) NOT NULL,
  `source_url` VARCHAR(4096) NOT NULL,
  `title` VARCHAR(500),
  `description` VARCHAR(2000),
  `etag` VARCHAR(1024),
  `content_hash` CHAR(64) NOT NULL,
  `content_object_key` VARCHAR(2048) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`run_id`, `id`),
  CONSTRAINT `source_crawl_preview_pages_hash_ck` CHECK (
    `id` REGEXP '^[a-f0-9]{64}$' AND `page_id` REGEXP '^[a-f0-9]{64}$'
    AND `content_hash` REGEXP '^[a-f0-9]{64}$'
  ),
  FOREIGN KEY (`run_id`) REFERENCES `source_workflow_runs` (`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_crawl_preview_pages_page_uq`
  ON `source_crawl_preview_pages` (`run_id`, `page_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `deletion_jobs_scope_id_uq`
  ON `deletion_jobs` (`tenant_id`, `knowledge_space_id`, `id`);

CREATE TABLE IF NOT EXISTS `source_bulk_workflow_items` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `source_id` CHAR(36) NOT NULL,
  `child_run_id` CHAR(36),
  `deletion_job_id` CHAR(36),
  `action` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `reason` VARCHAR(1000),
  `error_code` VARCHAR(64),
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `source_bulk_workflow_items_action_ck`
    CHECK (`action` IN ('sync', 'disable', 'remove')),
  CONSTRAINT `source_bulk_workflow_items_status_ck`
    CHECK (`status` IN ('eligible', 'running', 'skipped', 'failed', 'completed')),
  CONSTRAINT `source_bulk_workflow_items_child_ck` CHECK (
    (`child_run_id` IS NULL AND `deletion_job_id` IS NULL
      AND `status` IN ('eligible', 'skipped', 'failed'))
    OR (`child_run_id` IS NULL AND `deletion_job_id` IS NULL
      AND `action` = 'disable' AND `status` = 'completed')
    OR (`child_run_id` IS NOT NULL AND `deletion_job_id` IS NULL
      AND `action` = 'sync' AND `status` IN ('running', 'failed', 'completed'))
    OR (`child_run_id` IS NULL AND `deletion_job_id` IS NOT NULL
      AND `action` = 'remove' AND `status` IN ('running', 'failed', 'completed'))
  ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `run_id`)
    REFERENCES `source_workflow_runs` (`tenant_id`, `knowledge_space_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `child_run_id`)
    REFERENCES `source_workflow_runs` (`tenant_id`, `knowledge_space_id`, `id`),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `deletion_job_id`)
    REFERENCES `deletion_jobs` (`tenant_id`, `knowledge_space_id`, `id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_bulk_workflow_items_source_uq`
  ON `source_bulk_workflow_items` (`run_id`, `source_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_bulk_workflow_items_child_uq`
  ON `source_bulk_workflow_items` (`child_run_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_bulk_workflow_items_deletion_job_uq`
  ON `source_bulk_workflow_items` (`deletion_job_id`);
CREATE INDEX IF NOT EXISTS `source_bulk_workflow_items_list_idx`
  ON `source_bulk_workflow_items` (`tenant_id`, `knowledge_space_id`, `run_id`, `id`);
