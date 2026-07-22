-- Knowledge Platform schema migration
-- Migration id: 0010_page_index_upgrade_backfill
-- Dialect: tidb

CREATE TABLE IF NOT EXISTS `page_index_upgrade_backfills` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `publication_id` CHAR(36) NOT NULL,
  `publication_fingerprint` VARCHAR(86) NOT NULL,
  `head_revision` INT NOT NULL,
  `run_state` VARCHAR(16) NOT NULL,
  `total_items` INT NOT NULL,
  `completed_items` INT NOT NULL,
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
  CONSTRAINT `page_index_upgrade_backfills_state_ck`
    CHECK (`run_state` IN ('queued', 'running', 'succeeded', 'failed', 'superseded')),
  CONSTRAINT `page_index_upgrade_backfills_counts_ck`
    CHECK (`total_items` >= 0 AND `completed_items` >= 0 AND `completed_items` <= `total_items`),
  CONSTRAINT `page_index_upgrade_backfills_revision_ck` CHECK (`head_revision` > 0),
  CONSTRAINT `page_index_upgrade_backfills_retry_ck` CHECK (`retry_count` >= 0),
  CONSTRAINT `page_index_upgrade_backfills_row_version_ck` CHECK (`row_version` >= 0),
  CONSTRAINT `page_index_upgrade_backfills_lease_ck`
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
  CONSTRAINT `page_index_upgrade_backfills_terminal_ck`
    CHECK (
      (`run_state` IN ('succeeded', 'failed', 'superseded') AND `completed_at` IS NOT NULL)
      OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL)
    ),
  CONSTRAINT `page_index_upgrade_backfills_lease_token_ck`
    CHECK (
      `lease_token` IS NULL
      OR (
        `lease_token` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
        AND `lease_token` <> '00000000-0000-0000-0000-000000000000'
      )
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `publication_id`, `publication_fingerprint`
  ) REFERENCES `projection_set_publications` (
    `tenant_id`, `knowledge_space_id`, `id`, `fingerprint`
  ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `page_index_upgrade_backfills_publication_uq`
  ON `page_index_upgrade_backfills` (`tenant_id`, `knowledge_space_id`, `publication_id`);
CREATE INDEX IF NOT EXISTS `page_index_upgrade_backfills_scope_idx`
  ON `page_index_upgrade_backfills` (
    `tenant_id`, `knowledge_space_id`, `head_revision`, `updated_at`, `id`
  );
CREATE INDEX IF NOT EXISTS `page_index_upgrade_backfills_claim_idx`
  ON `page_index_upgrade_backfills` (`run_state`, `lease_expires_at`, `updated_at`, `id`);

CREATE TABLE IF NOT EXISTS `page_index_upgrade_backfill_items` (
  `backfill_id` CHAR(36) NOT NULL,
  `document_outline_id` CHAR(36) NOT NULL,
  `publication_generation_id` CHAR(36) NOT NULL,
  `document_asset_id` CHAR(36) NOT NULL,
  `document_version` INT NOT NULL,
  `ordinal` INT NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`backfill_id`, `document_outline_id`),
  CONSTRAINT `page_index_upgrade_items_generation_ck`
    CHECK (
      `publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
      AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000'
    ),
  CONSTRAINT `page_index_upgrade_items_version_ck` CHECK (`document_version` > 0),
  CONSTRAINT `page_index_upgrade_items_ordinal_ck` CHECK (`ordinal` >= 0),
  CONSTRAINT `page_index_upgrade_items_status_ck` CHECK (`status` IN ('pending', 'succeeded')),
  FOREIGN KEY (`backfill_id`) REFERENCES `page_index_upgrade_backfills` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `page_index_upgrade_items_ordinal_uq`
  ON `page_index_upgrade_backfill_items` (`backfill_id`, `ordinal`);
CREATE INDEX IF NOT EXISTS `page_index_upgrade_items_next_idx`
  ON `page_index_upgrade_backfill_items` (
    `backfill_id`, `status`, `ordinal`, `document_outline_id`
  );

INSERT IGNORE INTO `page_index_upgrade_backfills` (
  `id`, `tenant_id`, `knowledge_space_id`, `publication_id`,
  `publication_fingerprint`, `head_revision`, `run_state`, `total_items`,
  `completed_items`, `retry_count`, `row_version`, `created_at`, `updated_at`
)
SELECT
  head.`publication_id`,
  head.`tenant_id`,
  head.`knowledge_space_id`,
  head.`publication_id`,
  pub.`fingerprint`,
  head.`head_revision`,
  'queued',
  (
    SELECT COUNT(*)
    FROM `projection_set_publication_members` all_pm
    WHERE all_pm.`tenant_id` = head.`tenant_id`
      AND all_pm.`knowledge_space_id` = head.`knowledge_space_id`
      AND all_pm.`publication_id` = head.`publication_id`
      AND all_pm.`component_type` = 'document-outline'
  ),
  0,
  0,
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `projection_set_publication_heads` head
JOIN `projection_set_publications` pub
  ON pub.`tenant_id` = head.`tenant_id`
  AND pub.`knowledge_space_id` = head.`knowledge_space_id`
  AND pub.`id` = head.`publication_id`
  AND pub.`status` = 'published'
WHERE EXISTS (
  SELECT 1
  FROM `projection_set_publication_members` pm
  LEFT JOIN `document_outlines` outline_row
    ON outline_row.`id` = pm.`component_key`
    AND outline_row.`knowledge_space_id` = pm.`knowledge_space_id`
    AND outline_row.`publication_generation_id` = pm.`generation_id`
    AND outline_row.`document_asset_id` = pm.`document_asset_id`
  LEFT JOIN `page_index_manifests` manifest
    ON manifest.`knowledge_space_id` = pm.`knowledge_space_id`
    AND manifest.`document_outline_id` = pm.`component_key`
    AND manifest.`publication_generation_id` = pm.`generation_id`
    AND manifest.`document_asset_id` = pm.`document_asset_id`
    AND manifest.`document_version` = outline_row.`version`
    AND manifest.`tokenizer_version` = 'pageindex-nfkc-exact-v1'
    AND manifest.`status` = 'ready'
  WHERE pm.`tenant_id` = head.`tenant_id`
    AND pm.`knowledge_space_id` = head.`knowledge_space_id`
    AND pm.`publication_id` = head.`publication_id`
    AND pm.`component_type` = 'document-outline'
    AND (
      pm.`generation_id` = '00000000-0000-0000-0000-000000000000'
      OR outline_row.`id` IS NULL
      OR manifest.`id` IS NULL
      OR manifest.`checksum` NOT REGEXP '^[0-9a-f]{64}$'
      OR manifest.`node_count` <= 0
      OR manifest.`term_count` <= 0
      OR manifest.`node_count` <> (
        SELECT COUNT(*) FROM `page_index_nodes` node_row
        WHERE node_row.`manifest_id` = manifest.`id`
      )
      OR manifest.`term_count` <> (
        SELECT COUNT(*) FROM `page_index_terms` term_row
        WHERE term_row.`manifest_id` = manifest.`id`
      )
      OR EXISTS (
        SELECT 1 FROM `page_index_terms` term_row
        LEFT JOIN `page_index_nodes` node_row
          ON node_row.`id` = term_row.`page_index_node_id`
          AND node_row.`manifest_id` = term_row.`manifest_id`
        WHERE term_row.`manifest_id` = manifest.`id`
          AND (
            term_row.`knowledge_space_id` <> pm.`knowledge_space_id`
            OR node_row.`id` IS NULL
          )
      )
    )
);

INSERT IGNORE INTO `page_index_upgrade_backfill_items` (
  `backfill_id`, `document_outline_id`, `publication_generation_id`,
  `document_asset_id`, `document_version`, `ordinal`, `status`, `created_at`, `updated_at`
)
SELECT
  job.`id`,
  pm.`component_key`,
  pm.`generation_id`,
  pm.`document_asset_id`,
  outline_row.`version`,
  ROW_NUMBER() OVER (
    PARTITION BY job.`id` ORDER BY pm.`component_key`, pm.`generation_id`
  ) - 1,
  'pending',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `page_index_upgrade_backfills` job
JOIN `projection_set_publication_members` pm
  ON pm.`tenant_id` = job.`tenant_id`
  AND pm.`knowledge_space_id` = job.`knowledge_space_id`
  AND pm.`publication_id` = job.`publication_id`
  AND pm.`component_type` = 'document-outline'
JOIN `document_outlines` outline_row
  ON outline_row.`id` = pm.`component_key`
  AND outline_row.`knowledge_space_id` = pm.`knowledge_space_id`
  AND outline_row.`publication_generation_id` = pm.`generation_id`
  AND outline_row.`document_asset_id` = pm.`document_asset_id`
WHERE job.`run_state` = 'queued';
