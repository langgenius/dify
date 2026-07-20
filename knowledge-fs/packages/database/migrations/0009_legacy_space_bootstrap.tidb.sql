-- Knowledge Platform schema migration
-- Migration id: 0009_legacy_space_bootstrap
-- Dialect: tidb

-- Legacy NULL-generation artifacts cannot be adopted safely: historical Graph entities may span
-- documents and therefore do not have a recoverable single-document owner. A bootstrap instead
-- rebuilds the frozen document snapshot through the durable generation writer. The job row is
-- also the query-readiness latch: strict readers remain unavailable until run_state=succeeded.
CREATE TABLE IF NOT EXISTS `legacy_space_publication_bootstraps` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(255) NOT NULL,
  `checkpoint` VARCHAR(32) NOT NULL,
  `run_state` VARCHAR(16) NOT NULL,
  `total_documents` INT NOT NULL,
  `completed_documents` INT NOT NULL,
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `heartbeat_at` DATETIME(3),
  `last_error_code` VARCHAR(64),
  `last_error_message` TEXT,
  `row_version` INT NOT NULL,
  `published_publication_id` CHAR(36),
  `published_fingerprint` VARCHAR(86),
  `published_head_revision` INT,
  `snapshot_metadata` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  CONSTRAINT `legacy_space_bootstraps_checkpoint_ck`
    CHECK (
      `checkpoint` IN (
        'pending_snapshot',
        'snapshot_captured',
        'rebuilding',
        'verifying',
        'published'
      )
    ),
  CONSTRAINT `legacy_space_bootstraps_run_state_ck`
    CHECK (`run_state` IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT `legacy_space_bootstraps_counts_ck`
    CHECK (
      `total_documents` >= 0
      AND `completed_documents` >= 0
      AND `completed_documents` <= `total_documents`
    ),
  CONSTRAINT `legacy_space_bootstraps_row_version_ck` CHECK (`row_version` >= 0),
  CONSTRAINT `legacy_space_bootstraps_lease_state_ck`
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
  CONSTRAINT `legacy_space_bootstraps_terminal_ck`
    CHECK (
      (`run_state` IN ('succeeded', 'failed', 'canceled') AND `completed_at` IS NOT NULL)
      OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL)
    ),
  CONSTRAINT `legacy_space_bootstraps_lease_token_ck`
    CHECK (
      `lease_token` IS NULL
      OR (
        `lease_token` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
        AND `lease_token` <> '00000000-0000-0000-0000-000000000000'
      )
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`)
    ON DELETE CASCADE,
  FOREIGN KEY (
    `tenant_id`,
    `knowledge_space_id`,
    `published_publication_id`,
    `published_fingerprint`
  )
    REFERENCES `projection_set_publications` (
      `tenant_id`,
      `knowledge_space_id`,
      `id`,
      `fingerprint`
    )
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `legacy_space_bootstraps_space_uq`
  ON `legacy_space_publication_bootstraps` (`tenant_id`, `knowledge_space_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `legacy_space_bootstraps_idempotency_uq`
  ON `legacy_space_publication_bootstraps` (
    `tenant_id`,
    `knowledge_space_id`,
    `idempotency_key`
  );
CREATE INDEX IF NOT EXISTS `legacy_space_bootstraps_claim_idx`
  ON `legacy_space_publication_bootstraps` (
    `run_state`,
    `lease_expires_at`,
    `updated_at`,
    `id`
  );

CREATE TABLE IF NOT EXISTS `legacy_space_publication_bootstrap_items` (
  `bootstrap_id` CHAR(36) NOT NULL,
  `document_asset_id` CHAR(36) NOT NULL,
  `document_version` INT NOT NULL,
  `document_sha256` VARCHAR(64) NOT NULL,
  `ordinal` INT NOT NULL,
  `compilation_attempt_id` CHAR(36),
  `status` VARCHAR(16) NOT NULL,
  `last_error` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`bootstrap_id`, `document_asset_id`),
  CONSTRAINT `legacy_space_bootstrap_items_version_ck` CHECK (`document_version` > 0),
  CONSTRAINT `legacy_space_bootstrap_items_ordinal_ck` CHECK (`ordinal` >= 0),
  CONSTRAINT `legacy_space_bootstrap_items_status_ck`
    CHECK (`status` IN ('pending', 'running', 'succeeded', 'failed')),
  FOREIGN KEY (`bootstrap_id`)
    REFERENCES `legacy_space_publication_bootstraps` (`id`)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `legacy_space_bootstrap_items_ordinal_uq`
  ON `legacy_space_publication_bootstrap_items` (`bootstrap_id`, `ordinal`);
CREATE INDEX IF NOT EXISTS `legacy_space_bootstrap_items_next_idx`
  ON `legacy_space_publication_bootstrap_items` (
    `bootstrap_id`,
    `status`,
    `ordinal`,
    `document_asset_id`
  );
CREATE INDEX IF NOT EXISTS `legacy_space_bootstrap_items_attempt_idx`
  ON `legacy_space_publication_bootstrap_items` (
    `compilation_attempt_id`,
    `bootstrap_id`,
    `document_asset_id`
  );

CREATE TABLE IF NOT EXISTS `knowledge_space_mutation_leases` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `acquired_at` DATETIME(3) NOT NULL,
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`)
    ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_mutation_leases_space_uq`
  ON `knowledge_space_mutation_leases` (`tenant_id`, `knowledge_space_id`);

-- Pre-create a fail-closed marker for every pre-cutover space that has data but no published head.
-- The bounded runtime captures the exact document set later under the stable space-row lock.
INSERT IGNORE INTO `legacy_space_publication_bootstraps` (
  `id`,
  `tenant_id`,
  `knowledge_space_id`,
  `idempotency_key`,
  `checkpoint`,
  `run_state`,
  `total_documents`,
  `completed_documents`,
  `row_version`,
  `snapshot_metadata`,
  `created_at`,
  `updated_at`
)
SELECT
  ks.`id`,
  ks.`tenant_id`,
  ks.`id`,
  'legacy-space-publication-bootstrap-v1',
  'pending_snapshot',
  'queued',
  0,
  0,
  0,
  JSON_OBJECT(
    'schemaVersion',
    1,
    'strategy',
    'full-generation-rebuild',
    'source',
    'migration-marker'
  ),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `knowledge_spaces` ks
WHERE NOT EXISTS (
  SELECT 1
  FROM `projection_set_publication_heads` head
  WHERE head.`tenant_id` = ks.`tenant_id`
    AND head.`knowledge_space_id` = ks.`id`
)
AND (
  EXISTS (
    SELECT 1 FROM `document_assets` asset
    WHERE asset.`knowledge_space_id` = ks.`id`
  )
  OR EXISTS (
    SELECT 1 FROM `knowledge_nodes` node
    WHERE node.`knowledge_space_id` = ks.`id`
      AND node.`publication_generation_id` IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM `index_projections` projection
    WHERE projection.`knowledge_space_id` = ks.`id`
      AND projection.`publication_generation_id` IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM `document_outlines` outline_row
    WHERE outline_row.`knowledge_space_id` = ks.`id`
      AND outline_row.`publication_generation_id` IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM `document_multimodal_manifests` manifest
    WHERE manifest.`knowledge_space_id` = ks.`id`
      AND manifest.`publication_generation_id` IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM `knowledge_paths` path_row
    WHERE path_row.`knowledge_space_id` = ks.`id`
      AND path_row.`publication_generation_id` IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM `graph_entities` entity
    WHERE entity.`knowledge_space_id` = ks.`id`
      AND entity.`publication_generation_id` IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM `graph_relations` relation_row
    WHERE relation_row.`knowledge_space_id` = ks.`id`
      AND relation_row.`publication_generation_id` IS NULL
  )
);
