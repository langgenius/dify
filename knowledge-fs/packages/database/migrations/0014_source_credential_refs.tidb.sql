-- Knowledge Platform schema migration
-- Migration id: 0014_source_credential_refs
-- Dialect: tidb

-- Source rows retain only an opaque reference. Secret bytes live in the configured SecretStore;
-- legacy metadata.credentials values are moved by a fenced, restart-safe application worker.
ALTER TABLE `sources`
  ADD COLUMN IF NOT EXISTS `credential_ref` VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS `sources_credential_ref_uq`
  ON `sources` (`credential_ref`);
CREATE INDEX IF NOT EXISTS `sources_credential_backfill_discovery_idx`
  ON `sources` (`credential_ref`, `id`);
CREATE UNIQUE INDEX IF NOT EXISTS `sources_space_id_uq`
  ON `sources` (`knowledge_space_id`, `id`);

CREATE TABLE IF NOT EXISTS `source_credential_backfills` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `source_id` CHAR(36) NOT NULL,
  `source_version` INT NOT NULL,
  `candidate_credential_ref` VARCHAR(255) NOT NULL,
  `secret_fingerprint` CHAR(64) NOT NULL,
  `run_state` VARCHAR(16) NOT NULL,
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `heartbeat_at` DATETIME(3),
  `retry_count` INT NOT NULL,
  `row_version` INT NOT NULL,
  `last_error_code` VARCHAR(64),
  `last_error_message` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  CONSTRAINT `source_credential_backfills_source_version_ck`
    CHECK (`source_version` >= 1),
  CONSTRAINT `source_credential_backfills_counts_ck`
    CHECK (`retry_count` >= 0 AND `row_version` >= 0),
  CONSTRAINT `source_credential_backfills_state_ck`
    CHECK (`run_state` IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT `source_credential_backfills_lease_ck`
    CHECK (
      (
        `run_state` = 'running'
        AND `worker_id` IS NOT NULL
        AND `lease_token` IS NOT NULL
        AND `lease_expires_at` IS NOT NULL
        AND `heartbeat_at` IS NOT NULL
        AND `completed_at` IS NULL
      )
      OR (
        `run_state` <> 'running'
        AND `worker_id` IS NULL
        AND `lease_token` IS NULL
        AND `lease_expires_at` IS NULL
        AND `heartbeat_at` IS NULL
      )
    ),
  CONSTRAINT `source_credential_backfills_terminal_ck`
    CHECK (
      (`run_state` IN ('succeeded', 'failed') AND `completed_at` IS NOT NULL)
      OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL)
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`knowledge_space_id`, `source_id`)
    REFERENCES `sources` (`knowledge_space_id`, `id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `source_credential_backfills_source_uq`
  ON `source_credential_backfills` (`tenant_id`, `knowledge_space_id`, `source_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `source_credential_backfills_candidate_ref_uq`
  ON `source_credential_backfills` (`candidate_credential_ref`);
CREATE INDEX IF NOT EXISTS `source_credential_backfills_claim_idx`
  ON `source_credential_backfills` (`run_state`, `lease_expires_at`, `updated_at`, `id`);
CREATE INDEX IF NOT EXISTS `source_credential_backfills_scope_idx`
  ON `source_credential_backfills` (`tenant_id`, `knowledge_space_id`, `source_id`, `id`);

-- This ledger intentionally has no FK to sources/spaces: credential erasure must survive resource
-- deletion long enough for the cleanup worker to remove encrypted bytes from SecretStore.
CREATE TABLE IF NOT EXISTS `source_secret_lifecycle_refs` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `source_id` CHAR(36) NOT NULL,
  `credential_ref` VARCHAR(255) NOT NULL,
  `operation_id` VARCHAR(255) NOT NULL,
  `purpose` VARCHAR(16) NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `source_version` INT,
  `recover_after` DATETIME(3) NOT NULL,
  `next_delete_at` DATETIME(3),
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `heartbeat_at` DATETIME(3),
  `delete_attempts` INT NOT NULL,
  `row_version` INT NOT NULL,
  `last_error_code` VARCHAR(64),
  `last_error_message` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3),
  CONSTRAINT `source_secret_lifecycle_refs_source_version_ck`
    CHECK (`source_version` IS NULL OR `source_version` >= 1),
  CONSTRAINT `source_secret_lifecycle_refs_purpose_ck`
    CHECK (`purpose` IN ('create', 'rotate', 'backfill')),
  CONSTRAINT `source_secret_lifecycle_refs_counts_ck`
    CHECK (`delete_attempts` >= 0 AND `row_version` >= 0),
  CONSTRAINT `source_secret_lifecycle_refs_state_ck`
    CHECK (`state` IN ('staged', 'candidate', 'active', 'retired', 'deleting', 'deleted')),
  CONSTRAINT `source_secret_lifecycle_refs_lease_ck`
    CHECK (
      (
        `state` = 'deleting'
        AND `worker_id` IS NOT NULL
        AND `lease_token` IS NOT NULL
        AND `lease_expires_at` IS NOT NULL
        AND `heartbeat_at` IS NOT NULL
        AND `deleted_at` IS NULL
      )
      OR (
        `state` <> 'deleting'
        AND `worker_id` IS NULL
        AND `lease_token` IS NULL
        AND `lease_expires_at` IS NULL
        AND `heartbeat_at` IS NULL
      )
    ),
  CONSTRAINT `source_secret_lifecycle_refs_terminal_ck`
    CHECK (
      (`state` = 'deleted' AND `deleted_at` IS NOT NULL)
      OR (`state` <> 'deleted' AND `deleted_at` IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS `source_secret_lifecycle_refs_ref_uq`
  ON `source_secret_lifecycle_refs` (`credential_ref`);
CREATE INDEX IF NOT EXISTS `source_secret_lifecycle_refs_operation_idx`
  ON `source_secret_lifecycle_refs` (`operation_id`, `state`, `id`);
CREATE INDEX IF NOT EXISTS `source_secret_lifecycle_refs_claim_idx`
  ON `source_secret_lifecycle_refs`
    (`state`, `next_delete_at`, `lease_expires_at`, `updated_at`, `id`);
CREATE INDEX IF NOT EXISTS `source_secret_lifecycle_refs_recovery_idx`
  ON `source_secret_lifecycle_refs` (`state`, `recover_after`, `id`);
CREATE INDEX IF NOT EXISTS `source_secret_lifecycle_refs_scope_idx`
  ON `source_secret_lifecycle_refs` (`tenant_id`, `knowledge_space_id`, `source_id`, `id`);

-- Rolling upgrades may replay this migration after credential refs were already written. Register
-- those refs as active before application traffic can rotate/revoke them; source ids are stable UUIDs
-- and are safe deterministic lifecycle ids in this table's independent keyspace.
INSERT IGNORE INTO `source_secret_lifecycle_refs` (
  `id`, `tenant_id`, `knowledge_space_id`, `source_id`, `credential_ref`, `operation_id`,
  `purpose`, `state`, `source_version`, `recover_after`, `delete_attempts`, `row_version`,
  `created_at`, `updated_at`
)
SELECT
  src.`id`, space.`tenant_id`, src.`knowledge_space_id`, src.`id`, src.`credential_ref`,
  CONCAT('legacy-source:', src.`id`, ':', src.`version`),
  'rotate', 'active', src.`version`, src.`updated_at`, 0, 0, src.`updated_at`, src.`updated_at`
FROM `sources` src
INNER JOIN `knowledge_spaces` space ON space.`id` = src.`knowledge_space_id`
WHERE src.`credential_ref` IS NOT NULL;

-- INSERT IGNORE makes crash replay safe, but it must never hide a ref/id collision or a partial
-- rolling-upgrade registry. TiDB does not support stored routines, so a temporary NOT NULL guard
-- receives an invalid row only when a mismatch exists. The conditional INSERT then fails closed.
DROP TEMPORARY TABLE IF EXISTS `kfs_source_secret_lifecycle_registry_guard`;
CREATE TEMPORARY TABLE `kfs_source_secret_lifecycle_registry_guard` (
  `valid` TINYINT NOT NULL
);

INSERT INTO `kfs_source_secret_lifecycle_registry_guard` (`valid`)
SELECT NULL
WHERE EXISTS (
    SELECT 1
    FROM `sources` src
    INNER JOIN `knowledge_spaces` space ON space.`id` = src.`knowledge_space_id`
    LEFT JOIN `source_secret_lifecycle_refs` lifecycle
      ON lifecycle.`credential_ref` = src.`credential_ref`
    WHERE src.`credential_ref` IS NOT NULL
      AND (
        lifecycle.`id` IS NULL
        OR lifecycle.`state` <> 'active'
        OR lifecycle.`tenant_id` <> space.`tenant_id`
        OR lifecycle.`knowledge_space_id` <> src.`knowledge_space_id`
        OR lifecycle.`source_id` <> src.`id`
      )
  );

INSERT INTO `kfs_source_secret_lifecycle_registry_guard` (`valid`)
SELECT NULL
WHERE EXISTS (
    SELECT 1
    FROM `source_secret_lifecycle_refs` lifecycle
    LEFT JOIN `sources` src
      ON src.`id` = lifecycle.`source_id`
      AND src.`knowledge_space_id` = lifecycle.`knowledge_space_id`
    LEFT JOIN `knowledge_spaces` space
      ON space.`id` = lifecycle.`knowledge_space_id`
    WHERE lifecycle.`state` = 'active'
      AND (
        src.`id` IS NULL
        OR NOT (src.`credential_ref` <=> lifecycle.`credential_ref`)
        OR space.`id` IS NULL
        OR NOT (space.`tenant_id` <=> lifecycle.`tenant_id`)
      )
  );

DROP TEMPORARY TABLE `kfs_source_secret_lifecycle_registry_guard`;
