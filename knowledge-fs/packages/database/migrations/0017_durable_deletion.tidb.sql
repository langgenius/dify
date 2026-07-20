-- Knowledge Platform schema migration
-- Migration id: 0017_durable_deletion
-- Dialect: tidb

ALTER TABLE `knowledge_spaces`
  ADD COLUMN IF NOT EXISTS `revision` INT NOT NULL DEFAULT 1;
ALTER TABLE `knowledge_spaces`
  ADD COLUMN IF NOT EXISTS `lifecycle_state` VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE `knowledge_spaces`
  ADD COLUMN IF NOT EXISTS `deletion_job_id` CHAR(36);
ALTER TABLE `knowledge_spaces`
  ADD COLUMN IF NOT EXISTS `deleting_at` DATETIME(3);

ALTER TABLE `sources`
  ADD COLUMN IF NOT EXISTS `deletion_job_id` CHAR(36);
ALTER TABLE `sources`
  ADD COLUMN IF NOT EXISTS `deleting_at` DATETIME(3);

ALTER TABLE `document_assets`
  ADD COLUMN IF NOT EXISTS `lifecycle_state` VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE `document_assets`
  ADD COLUMN IF NOT EXISTS `deletion_job_id` CHAR(36);
ALTER TABLE `document_assets`
  ADD COLUMN IF NOT EXISTS `deleting_at` DATETIME(3);
ALTER TABLE `document_assets`
  ADD COLUMN IF NOT EXISTS `row_version` INT NOT NULL DEFAULT 1;

ALTER TABLE `knowledge_space_mutation_leases`
  ADD COLUMN IF NOT EXISTS `lease_token` CHAR(36);
ALTER TABLE `knowledge_space_mutation_leases`
  ADD COLUMN IF NOT EXISTS `heartbeat_at` DATETIME(3);
ALTER TABLE `knowledge_space_mutation_leases`
  ADD COLUMN IF NOT EXISTS `expires_at` DATETIME(3);
UPDATE `knowledge_space_mutation_leases`
SET `lease_token` = `id`, `heartbeat_at` = `acquired_at`, `expires_at` = `acquired_at`
WHERE `lease_token` IS NULL OR `heartbeat_at` IS NULL OR `expires_at` IS NULL;

-- Fail closed rather than silently rewriting a historical cross-tenant manifest. A temporary
-- NOT NULL guard is used because TiDB does not support a portable top-level conditional SIGNAL.
DROP TEMPORARY TABLE IF EXISTS `kfs_0017_manifest_space_guard`;
CREATE TEMPORARY TABLE `kfs_0017_manifest_space_guard` (`valid` TINYINT NOT NULL);
INSERT INTO `kfs_0017_manifest_space_guard` (`valid`)
SELECT NULL
WHERE EXISTS (
  SELECT 1
  FROM `knowledge_space_manifests` AS manifest
  LEFT JOIN `knowledge_spaces` AS space
    ON space.`tenant_id` = manifest.`tenant_id`
   AND space.`id` = manifest.`knowledge_space_id`
  WHERE space.`id` IS NULL
);
DROP TEMPORARY TABLE `kfs_0017_manifest_space_guard`;

SET @kfs_0017_manifest_space_fk_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'knowledge_space_manifests'
      AND constraint_name = 'knowledge_space_manifests_space_fk'
  ),
  'DO 0',
  'ALTER TABLE `knowledge_space_manifests` ADD CONSTRAINT `knowledge_space_manifests_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`) REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE'
);
PREPARE kfs_0017_manifest_space_fk_stmt FROM @kfs_0017_manifest_space_fk_sql;
EXECUTE kfs_0017_manifest_space_fk_stmt;
DEALLOCATE PREPARE kfs_0017_manifest_space_fk_stmt;

-- TiDB assigned the original anonymous FK a generated name. Resolve that exact one-column
-- relationship from the catalog instead of assuming the generated name is stable across clusters.
SET @kfs_0017_manifest_legacy_fk_name = (
  SELECT key_usage.constraint_name
  FROM information_schema.key_column_usage AS key_usage
  INNER JOIN information_schema.referential_constraints AS reference_constraint
    ON reference_constraint.constraint_schema = key_usage.constraint_schema
   AND reference_constraint.table_name = key_usage.table_name
   AND reference_constraint.constraint_name = key_usage.constraint_name
  WHERE key_usage.constraint_schema = DATABASE()
    AND key_usage.table_name = 'knowledge_space_manifests'
    AND key_usage.referenced_table_name = 'knowledge_spaces'
  GROUP BY key_usage.constraint_name
  HAVING COUNT(*) = 1
    AND MIN(key_usage.column_name) = 'knowledge_space_id'
    AND MIN(key_usage.referenced_column_name) = 'id'
  LIMIT 1
);
SET @kfs_0017_manifest_legacy_fk_sql = IF(
  @kfs_0017_manifest_legacy_fk_name IS NULL,
  'DO 0',
  CONCAT(
    'ALTER TABLE `knowledge_space_manifests` DROP FOREIGN KEY `',
    REPLACE(@kfs_0017_manifest_legacy_fk_name, '`', '``'),
    '`'
  )
);
PREPARE kfs_0017_manifest_legacy_fk_stmt FROM @kfs_0017_manifest_legacy_fk_sql;
EXECUTE kfs_0017_manifest_legacy_fk_stmt;
DEALLOCATE PREPARE kfs_0017_manifest_legacy_fk_stmt;

-- Rolling evidence-bundle scoping. Ambiguous or unowned legacy rows intentionally stay NULL;
-- application reads quarantine them and rollout readiness requires their bounded purge.
ALTER TABLE `evidence_bundles`
  ADD COLUMN IF NOT EXISTS `tenant_id` VARCHAR(255);
ALTER TABLE `evidence_bundles`
  ADD COLUMN IF NOT EXISTS `knowledge_space_id` CHAR(36);

UPDATE `evidence_bundles` AS evidence
INNER JOIN (
  SELECT candidate.bundle_id,
         MIN(candidate.tenant_id) AS tenant_id,
         MIN(candidate.knowledge_space_id) AS knowledge_space_id
  FROM (
    SELECT evidence_from_trace.`id` AS bundle_id,
           space_from_trace.`tenant_id` AS tenant_id,
           trace.`knowledge_space_id` AS knowledge_space_id
    FROM `evidence_bundles` AS evidence_from_trace
    INNER JOIN `answer_traces` AS trace
      ON trace.`evidence_bundle_id` = evidence_from_trace.`id`
      OR trace.`id` = evidence_from_trace.`trace_id`
    INNER JOIN `knowledge_spaces` AS space_from_trace
      ON space_from_trace.`id` = trace.`knowledge_space_id`
    UNION ALL
    SELECT evidence_from_partial.`id` AS bundle_id,
           partial.`tenant_id` AS tenant_id,
           partial.`knowledge_space_id` AS knowledge_space_id
    FROM `evidence_bundles` AS evidence_from_partial
    INNER JOIN `research_task_partial_results` AS partial
      ON CASE
           WHEN JSON_TYPE(partial.`evidence_bundle`) = 'OBJECT'
             THEN JSON_UNQUOTE(JSON_EXTRACT(partial.`evidence_bundle`, '$.id'))
           ELSE NULL
         END = CAST(evidence_from_partial.`id` AS CHAR(36))
    INNER JOIN `knowledge_spaces` AS space_from_partial
      ON space_from_partial.`tenant_id` = partial.`tenant_id`
     AND space_from_partial.`id` = partial.`knowledge_space_id`
  ) AS candidate
  GROUP BY candidate.bundle_id
  HAVING COUNT(DISTINCT CONCAT(candidate.tenant_id, CHAR(0), candidate.knowledge_space_id)) = 1
) AS resolved ON resolved.bundle_id = evidence.`id`
SET evidence.`tenant_id` = resolved.tenant_id,
    evidence.`knowledge_space_id` = resolved.knowledge_space_id
WHERE evidence.`tenant_id` IS NULL
  AND evidence.`knowledge_space_id` IS NULL;

SET @kfs_0017_evidence_scope_pair_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'evidence_bundles'
      AND constraint_name = 'evidence_bundles_scope_pair_ck'
  ),
  'DO 0',
  'ALTER TABLE `evidence_bundles` ADD CONSTRAINT `evidence_bundles_scope_pair_ck` CHECK ((`tenant_id` IS NULL AND `knowledge_space_id` IS NULL) OR (`tenant_id` IS NOT NULL AND `knowledge_space_id` IS NOT NULL))'
);
PREPARE kfs_0017_evidence_scope_pair_stmt FROM @kfs_0017_evidence_scope_pair_sql;
EXECUTE kfs_0017_evidence_scope_pair_stmt;
DEALLOCATE PREPARE kfs_0017_evidence_scope_pair_stmt;

SET @kfs_0017_evidence_scope_fk_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'evidence_bundles'
      AND constraint_name = 'evidence_bundles_scope_fk'
  ),
  'DO 0',
  'ALTER TABLE `evidence_bundles` ADD CONSTRAINT `evidence_bundles_scope_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`) REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE'
);
PREPARE kfs_0017_evidence_scope_fk_stmt FROM @kfs_0017_evidence_scope_fk_sql;
EXECUTE kfs_0017_evidence_scope_fk_stmt;
DEALLOCATE PREPARE kfs_0017_evidence_scope_fk_stmt;

CREATE INDEX IF NOT EXISTS `evidence_bundles_scope_created_idx`
  ON `evidence_bundles` (`tenant_id`, `knowledge_space_id`, `created_at`, `id`);

-- TiDB commits DDL independently of the migration marker. Select either the exact ALTER or a
-- no-op so a marker-loss replay cannot duplicate constraints already committed.
SET @kfs_0017_space_lifecycle_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'knowledge_spaces'
      AND constraint_name = 'knowledge_spaces_deletion_lifecycle_ck'
  ),
  'DO 0',
  'ALTER TABLE `knowledge_spaces` ADD CONSTRAINT `knowledge_spaces_deletion_lifecycle_ck` CHECK (`revision` >= 1 AND ((`lifecycle_state` = ''active'' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL) OR (`lifecycle_state` = ''deleting'' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL)))'
);
PREPARE kfs_0017_space_lifecycle_stmt FROM @kfs_0017_space_lifecycle_sql;
EXECUTE kfs_0017_space_lifecycle_stmt;
DEALLOCATE PREPARE kfs_0017_space_lifecycle_stmt;

SET @kfs_0017_source_lifecycle_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'sources'
      AND constraint_name = 'sources_deletion_lifecycle_ck'
  ),
  'DO 0',
  'ALTER TABLE `sources` ADD CONSTRAINT `sources_deletion_lifecycle_ck` CHECK ((`status` = ''deleting'' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL) OR (`status` <> ''deleting'' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL))'
);
PREPARE kfs_0017_source_lifecycle_stmt FROM @kfs_0017_source_lifecycle_sql;
EXECUTE kfs_0017_source_lifecycle_stmt;
DEALLOCATE PREPARE kfs_0017_source_lifecycle_stmt;

SET @kfs_0017_document_lifecycle_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_assets'
      AND constraint_name = 'document_assets_deletion_lifecycle_ck'
  ),
  'DO 0',
  'ALTER TABLE `document_assets` ADD CONSTRAINT `document_assets_deletion_lifecycle_ck` CHECK (`row_version` >= 1 AND ((`lifecycle_state` = ''active'' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL) OR (`lifecycle_state` = ''deleting'' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL)))'
);
PREPARE kfs_0017_document_lifecycle_stmt FROM @kfs_0017_document_lifecycle_sql;
EXECUTE kfs_0017_document_lifecycle_stmt;
DEALLOCATE PREPARE kfs_0017_document_lifecycle_stmt;

-- Retrieval execution leases let durable deletion drain live reads. Skip the parent-table DDL
-- entirely on replay so TiDB does not revalidate the already-installed foreign key.
SET @kfs_0017_retrieval_execution_leases_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'retrieval_execution_leases'
);
SET @kfs_0017_retrieval_execution_leases_sql = IF(
  @kfs_0017_retrieval_execution_leases_exists = 0,
  'CREATE TABLE `retrieval_execution_leases` ( `id` CHAR(36) PRIMARY KEY NOT NULL, `tenant_id` VARCHAR(255) NOT NULL, `knowledge_space_id` CHAR(36) NOT NULL, `subject_id` TEXT NOT NULL, `trace_id` CHAR(36) NOT NULL, `lease_token` VARCHAR(128) NOT NULL, `status` VARCHAR(16) NOT NULL, `row_version` INT NOT NULL, `acquired_at` DATETIME(3) NOT NULL, `heartbeat_at` DATETIME(3) NOT NULL, `expires_at` DATETIME(3) NOT NULL, `updated_at` DATETIME(3) NOT NULL, CONSTRAINT `retrieval_execution_leases_state_ck` CHECK (`status` IN (''active'', ''released'', ''expired'') AND `row_version` >= 0 AND `heartbeat_at` >= `acquired_at` AND `expires_at` > `heartbeat_at` AND `updated_at` >= `acquired_at`), CONSTRAINT `retrieval_execution_leases_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`) REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE )',
  'DO 0'
);
PREPARE kfs_0017_retrieval_execution_leases_stmt
  FROM @kfs_0017_retrieval_execution_leases_sql;
EXECUTE kfs_0017_retrieval_execution_leases_stmt;
DEALLOCATE PREPARE kfs_0017_retrieval_execution_leases_stmt;

CREATE INDEX IF NOT EXISTS `retrieval_execution_leases_space_expiry_idx`
  ON `retrieval_execution_leases` (
    `tenant_id`, `knowledge_space_id`, `status`, `expires_at`, `id`
  );

-- deletion_jobs gains inbound FKs from items/outbox. TiDB can revalidate those FKs even for
-- CREATE TABLE IF NOT EXISTS, so skip parent-table DDL entirely once it exists.
SET @kfs_0017_deletion_jobs_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'deletion_jobs'
);
SET @kfs_0017_deletion_jobs_sql = IF(
  @kfs_0017_deletion_jobs_exists = 0,
  'CREATE TABLE `deletion_jobs` ( `id` CHAR(36) PRIMARY KEY NOT NULL, `tenant_id` VARCHAR(255) NOT NULL, `knowledge_space_id` CHAR(36) NOT NULL, `target_type` VARCHAR(32) NOT NULL, `target_id` CHAR(36) NOT NULL, `target_revision` INT NOT NULL, `delete_mode` VARCHAR(16) NOT NULL, `requested_by_subject_id` VARCHAR(255) NOT NULL, `permission_snapshot_id` CHAR(36) NOT NULL, `permission_snapshot_revision` INT NOT NULL, `access_channel` VARCHAR(16) NOT NULL, `api_key_id` CHAR(36), `api_key_revision` INT, `api_key_expires_at` DATETIME(3), `idempotency_key` VARCHAR(512) NOT NULL, `request_fingerprint` CHAR(64) NOT NULL, `name_challenge_digest` CHAR(64), `checkpoint` VARCHAR(32) NOT NULL, `scan_phase` VARCHAR(64), `scan_cursor` VARCHAR(1024), `inventory_complete` BOOLEAN NOT NULL, `run_state` VARCHAR(16) NOT NULL, `active_slot` INT, `execution_attempts` INT NOT NULL, `max_execution_attempts` INT NOT NULL, `retry_at` DATETIME(3), `worker_id` VARCHAR(255), `lease_token` CHAR(36), `lease_expires_at` DATETIME(3), `heartbeat_at` DATETIME(3), `queue_job_id` VARCHAR(255), `last_error_code` VARCHAR(64), `last_error_message` TEXT, `row_version` INT NOT NULL, `created_at` DATETIME(3) NOT NULL, `updated_at` DATETIME(3) NOT NULL, `started_at` DATETIME(3), `completed_at` DATETIME(3), CONSTRAINT `deletion_jobs_target_ck` CHECK (`target_type` IN (''knowledge_space'', ''source'', ''document_asset'') AND ((`target_type` = ''source'' AND `delete_mode` IN (''keep'', ''cascade'') AND `name_challenge_digest` IS NULL) OR (`target_type` = ''knowledge_space'' AND `delete_mode` = ''cascade'' AND `name_challenge_digest` IS NOT NULL) OR (`target_type` = ''document_asset'' AND `delete_mode` = ''cascade'' AND `name_challenge_digest` IS NULL))), CONSTRAINT `deletion_jobs_checkpoint_ck` CHECK (`checkpoint` IN (''requested'', ''quiescing'', ''deleting_objects'', ''deleting_derived_data'', ''deleting_primary_data'', ''completed'')), CONSTRAINT `deletion_jobs_run_state_ck` CHECK (`run_state` IN (''dispatch_pending'', ''queued'', ''running'', ''retry_wait'', ''succeeded'', ''failed'', ''canceled'')), CONSTRAINT `deletion_jobs_access_channel_ck` CHECK (`access_channel` IN (''interactive'', ''service_api'', ''mcp'', ''agent'')), CONSTRAINT `deletion_jobs_api_key_binding_ck` CHECK ((`api_key_id` IS NULL AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL) OR (`api_key_id` IS NOT NULL AND `api_key_revision` >= 1 AND `access_channel` = ''service_api'')), CONSTRAINT `deletion_jobs_positive_ck` CHECK (`target_revision` >= 1 AND `permission_snapshot_revision` >= 1 AND `row_version` >= 1 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts` AND (`active_slot` IS NULL OR `active_slot` = 1)), CONSTRAINT `deletion_jobs_lifecycle_ck` CHECK ((`run_state` IN (''dispatch_pending'', ''queued'', ''running'', ''retry_wait'', ''failed'') AND `active_slot` = 1 AND `completed_at` IS NULL) OR (`run_state` IN (''succeeded'', ''canceled'') AND `active_slot` IS NULL AND `completed_at` IS NOT NULL)), CONSTRAINT `deletion_jobs_completion_ck` CHECK ((`run_state` = ''succeeded'' AND `checkpoint` = ''completed'') OR (`run_state` <> ''succeeded'' AND `checkpoint` <> ''completed'')), CONSTRAINT `deletion_jobs_retry_ck` CHECK ((`run_state` = ''retry_wait'' AND `retry_at` IS NOT NULL) OR (`run_state` <> ''retry_wait'' AND `retry_at` IS NULL)), CONSTRAINT `deletion_jobs_lease_ck` CHECK ((`run_state` = ''running'' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL) OR (`run_state` <> ''running'' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL)))',
  'DO 0'
);
PREPARE kfs_0017_deletion_jobs_stmt FROM @kfs_0017_deletion_jobs_sql;
EXECUTE kfs_0017_deletion_jobs_stmt;
DEALLOCATE PREPARE kfs_0017_deletion_jobs_stmt;

CREATE UNIQUE INDEX IF NOT EXISTS `deletion_jobs_idempotency_uq`
  ON `deletion_jobs` (`tenant_id`, `idempotency_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `deletion_jobs_target_active_uq`
  ON `deletion_jobs` (
    `tenant_id`, `knowledge_space_id`, `target_type`, `target_id`, `active_slot`
  );
CREATE INDEX IF NOT EXISTS `deletion_jobs_claim_idx`
  ON `deletion_jobs` (`run_state`, `retry_at`, `lease_expires_at`, `created_at`, `id`);
CREATE INDEX IF NOT EXISTS `deletion_jobs_scope_history_idx`
  ON `deletion_jobs` (`tenant_id`, `knowledge_space_id`, `created_at`, `id`);
CREATE INDEX IF NOT EXISTS `deletion_jobs_requester_provenance_idx`
  ON `deletion_jobs` (
    `tenant_id`, `knowledge_space_id`, `requested_by_subject_id`,
    `api_key_id`, `api_key_revision`, `created_at`, `id`
  );

CREATE TABLE IF NOT EXISTS `deletion_tombstones` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `deletion_job_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `target_type` VARCHAR(32) NOT NULL,
  `target_id` CHAR(36) NOT NULL,
  `target_revision` INT NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `row_version` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  CONSTRAINT `deletion_tombstones_target_ck` CHECK (
    `target_type` IN ('knowledge_space', 'source', 'document_asset')
  ),
  CONSTRAINT `deletion_tombstones_state_ck` CHECK (
    (`state` = 'active' AND `completed_at` IS NULL)
    OR (`state` = 'completed' AND `completed_at` IS NOT NULL)
  ),
  CONSTRAINT `deletion_tombstones_positive_ck` CHECK (
    `target_revision` >= 1 AND `row_version` >= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS `deletion_tombstones_target_uq`
  ON `deletion_tombstones` (`tenant_id`, `target_type`, `target_id`);
CREATE INDEX IF NOT EXISTS `deletion_tombstones_space_target_idx`
  ON `deletion_tombstones` (`tenant_id`, `knowledge_space_id`, `target_type`, `target_id`);
CREATE INDEX IF NOT EXISTS `deletion_tombstones_job_idx`
  ON `deletion_tombstones` (`deletion_job_id`, `id`);

CREATE TABLE IF NOT EXISTS `deletion_job_items` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `deletion_job_id` CHAR(36) NOT NULL,
  `ordinal` BIGINT NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `resource_id` CHAR(36),
  `object_key` TEXT,
  `credential_ref` VARCHAR(255),
  `cache_key` TEXT,
  `payload_digest` CHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(512) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `attempts` INT NOT NULL,
  `max_attempts` INT NOT NULL,
  `next_attempt_at` DATETIME(3),
  `last_error_code` VARCHAR(64),
  `last_error_message` TEXT,
  `row_version` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  `redacted_at` DATETIME(3),
  CONSTRAINT `deletion_job_items_kind_ck` CHECK (
    `kind` IN ('object', 'secret_ref', 'cache_key', 'document_cascade', 'document_detach')
  ),
  CONSTRAINT `deletion_job_items_status_ck` CHECK (
    `status` IN ('pending', 'retry_wait', 'completed', 'dead')
  ),
  CONSTRAINT `deletion_job_items_positive_ck` CHECK (
    `ordinal` >= 0 AND `attempts` >= 0 AND `max_attempts` >= 1
    AND `attempts` <= `max_attempts` AND `row_version` >= 1
  ),
  CONSTRAINT `deletion_job_items_retry_ck` CHECK (
    (`status` = 'retry_wait' AND `next_attempt_at` IS NOT NULL)
    OR (`status` <> 'retry_wait' AND `next_attempt_at` IS NULL)
  ),
  CONSTRAINT `deletion_job_items_terminal_ck` CHECK (
    (`status` IN ('completed', 'dead') AND `completed_at` IS NOT NULL)
    OR (`status` IN ('pending', 'retry_wait') AND `completed_at` IS NULL)
  ),
  CONSTRAINT `deletion_job_items_payload_ck` CHECK (
    (`kind` = 'object' AND `credential_ref` IS NULL AND `cache_key` IS NULL
      AND ((`status` = 'completed' AND `object_key` IS NULL AND `redacted_at` IS NOT NULL)
        OR (`status` <> 'completed' AND `object_key` IS NOT NULL AND `redacted_at` IS NULL)))
    OR (`kind` = 'secret_ref' AND `object_key` IS NULL AND `cache_key` IS NULL
      AND ((`status` = 'completed' AND `credential_ref` IS NULL AND `redacted_at` IS NOT NULL)
        OR (`status` <> 'completed' AND `credential_ref` IS NOT NULL AND `redacted_at` IS NULL)))
    OR (`kind` = 'cache_key' AND `object_key` IS NULL AND `credential_ref` IS NULL
      AND ((`status` = 'completed' AND `cache_key` IS NULL AND `redacted_at` IS NOT NULL)
        OR (`status` <> 'completed' AND `cache_key` IS NOT NULL AND `redacted_at` IS NULL)))
    OR (`kind` IN ('document_cascade', 'document_detach') AND `resource_id` IS NOT NULL
      AND `object_key` IS NULL AND `credential_ref` IS NULL AND `cache_key` IS NULL
      AND `redacted_at` IS NULL)
  ),
  FOREIGN KEY (`deletion_job_id`) REFERENCES `deletion_jobs` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `deletion_job_items_idempotency_uq`
  ON `deletion_job_items` (`deletion_job_id`, `idempotency_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `deletion_job_items_ordinal_uq`
  ON `deletion_job_items` (`deletion_job_id`, `ordinal`);
CREATE INDEX IF NOT EXISTS `deletion_job_items_work_idx`
  ON `deletion_job_items` (
    `deletion_job_id`, `status`, `next_attempt_at`, `ordinal`, `id`
  );
CREATE INDEX IF NOT EXISTS `deletion_job_items_resource_idx`
  ON `deletion_job_items` (`deletion_job_id`, `kind`, `resource_id`, `id`);

CREATE TABLE IF NOT EXISTS `deletion_outbox` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `deletion_job_id` CHAR(36) NOT NULL,
  `delivery_revision` INT NOT NULL,
  `event_type` VARCHAR(32) NOT NULL,
  `schema_version` INT NOT NULL,
  `idempotency_key` VARCHAR(512) NOT NULL,
  `request_idempotency_key` VARCHAR(512) NOT NULL,
  `request_fingerprint` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `available_at` DATETIME(3) NOT NULL,
  `dispatch_attempts` INT NOT NULL,
  `locked_by` VARCHAR(255),
  `locked_until` DATETIME(3),
  `lock_token` CHAR(36),
  `queue_job_id` VARCHAR(255),
  `last_error` TEXT,
  `delivered_at` DATETIME(3),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `deletion_outbox_event_ck` CHECK (`event_type` = 'deletion.job'),
  CONSTRAINT `deletion_outbox_schema_ck` CHECK (`schema_version` = 1),
  CONSTRAINT `deletion_outbox_status_ck` CHECK (
    `status` IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')
  ),
  CONSTRAINT `deletion_outbox_positive_ck` CHECK (
    `delivery_revision` >= 1 AND `dispatch_attempts` >= 0
  ),
  CONSTRAINT `deletion_outbox_lock_ck` CHECK (
    (`lock_token` IS NULL AND `locked_by` IS NULL AND `locked_until` IS NULL)
    OR (`lock_token` IS NOT NULL AND `locked_by` IS NOT NULL AND `locked_until` IS NOT NULL)
  ),
  FOREIGN KEY (`deletion_job_id`) REFERENCES `deletion_jobs` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `deletion_outbox_idempotency_uq`
  ON `deletion_outbox` (`idempotency_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `deletion_outbox_job_delivery_uq`
  ON `deletion_outbox` (`deletion_job_id`, `delivery_revision`);
CREATE UNIQUE INDEX IF NOT EXISTS `deletion_outbox_job_request_uq`
  ON `deletion_outbox` (`deletion_job_id`, `request_idempotency_key`);
CREATE INDEX IF NOT EXISTS `deletion_outbox_claim_idx`
  ON `deletion_outbox` (`status`, `available_at`, `locked_until`, `id`);

-- Immutable retry provenance is kept separately so owner rescue never overwrites the original
-- requester on deletion_jobs. Permission snapshots and the target space may later be removed.
CREATE TABLE IF NOT EXISTS `deletion_retry_audits` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `deletion_job_id` CHAR(36) NOT NULL,
  `outbox_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `retry_authority` VARCHAR(32) NOT NULL,
  `actor_subject_id` VARCHAR(255) NOT NULL,
  `permission_snapshot_id` CHAR(36) NOT NULL,
  `permission_snapshot_revision` INT NOT NULL,
  `access_channel` VARCHAR(16) NOT NULL,
  `api_key_id` CHAR(36),
  `api_key_revision` INT,
  `api_key_expires_at` DATETIME(3),
  `request_idempotency_key` VARCHAR(512) NOT NULL,
  `request_fingerprint` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  CONSTRAINT `deletion_retry_audits_authority_ck` CHECK (
    `retry_authority` IN ('original_requester', 'interactive_owner_rescue')
  ),
  CONSTRAINT `deletion_retry_audits_access_channel_ck` CHECK (
    `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  CONSTRAINT `deletion_retry_audits_positive_ck` CHECK (
    `permission_snapshot_revision` >= 1
  ),
  CONSTRAINT `deletion_retry_audits_api_key_binding_ck` CHECK (
    (`api_key_id` IS NULL AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL)
    OR (`api_key_id` IS NOT NULL AND `api_key_revision` >= 1 AND `access_channel` = 'service_api')
  ),
  CONSTRAINT `deletion_retry_audits_owner_rescue_ck` CHECK (
    `retry_authority` <> 'interactive_owner_rescue'
    OR (
      `access_channel` = 'interactive'
      AND `api_key_id` IS NULL
      AND `api_key_revision` IS NULL
      AND `api_key_expires_at` IS NULL
    )
  ),
  FOREIGN KEY (`deletion_job_id`) REFERENCES `deletion_jobs` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `deletion_retry_audits_job_request_uq`
  ON `deletion_retry_audits` (`deletion_job_id`, `request_idempotency_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `deletion_retry_audits_outbox_uq`
  ON `deletion_retry_audits` (`outbox_id`);
CREATE INDEX IF NOT EXISTS `deletion_retry_audits_actor_idx`
  ON `deletion_retry_audits` (
    `tenant_id`, `knowledge_space_id`, `actor_subject_id`, `created_at`, `id`
  );

CREATE INDEX IF NOT EXISTS `knowledge_spaces_lifecycle_idx`
  ON `knowledge_spaces` (`tenant_id`, `lifecycle_state`, `updated_at`, `id`);
CREATE INDEX IF NOT EXISTS `sources_deletion_job_idx`
  ON `sources` (`knowledge_space_id`, `deletion_job_id`, `id`);
CREATE INDEX IF NOT EXISTS `document_assets_lifecycle_idx`
  ON `document_assets` (`knowledge_space_id`, `lifecycle_state`, `source_id`, `version`, `id`);
CREATE INDEX IF NOT EXISTS `page_index_manifests_document_idx`
  ON `page_index_manifests` (`document_asset_id`, `publication_generation_id`, `id`);

-- Agent workspace command logs and metadata are conservatively invalidated by whole space. The
-- durable row keeps exact creator authorization so reads remain consistent across API replicas.
CREATE TABLE IF NOT EXISTS `agent_workspace_snapshots` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `subject_id` VARCHAR(255) NOT NULL,
  `access_channel` VARCHAR(16) NOT NULL,
  `permission_snapshot_id` CHAR(36) NOT NULL,
  `permission_snapshot_revision` INT NOT NULL,
  `permission_scopes` JSON NOT NULL,
  `fingerprint` VARCHAR(80) NOT NULL,
  `payload` JSON NOT NULL,
  `invalidated_at` DATETIME(3),
  `invalidation_reason` VARCHAR(64),
  `created_at` DATETIME(3) NOT NULL,
  CONSTRAINT `agent_workspace_snapshots_channel_ck` CHECK (
    `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  CONSTRAINT `agent_workspace_snapshots_revision_ck` CHECK (
    `permission_snapshot_revision` >= 1
  ),
  CONSTRAINT `agent_workspace_snapshots_invalidation_ck` CHECK (
    (`invalidated_at` IS NULL AND `invalidation_reason` IS NULL)
    OR (`invalidated_at` IS NOT NULL AND `invalidation_reason` IS NOT NULL)
  ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `agent_workspace_snapshots_tenant_lookup_idx`
  ON `agent_workspace_snapshots` (`tenant_id`, `id`, `invalidated_at`);
CREATE INDEX IF NOT EXISTS `agent_workspace_snapshots_space_cleanup_idx`
  ON `agent_workspace_snapshots` (
    `tenant_id`, `knowledge_space_id`, `invalidated_at`, `id`
  );
