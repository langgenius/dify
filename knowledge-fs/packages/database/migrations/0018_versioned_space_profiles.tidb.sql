-- Knowledge Platform schema migration
-- Migration id: 0018_versioned_space_profiles
-- Dialect: tidb

-- Profile snapshots are append-only. Runtime transitions only mutate lifecycle columns.
CREATE TABLE IF NOT EXISTS `knowledge_space_profile_revisions` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `revision` INT NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `snapshot` JSON NOT NULL,
  `snapshot_digest` CHAR(64) NOT NULL,
  `capability_snapshot` JSON NOT NULL,
  `capability_snapshot_digest` CHAR(64) NOT NULL,
  `plugin_id` VARCHAR(256) NOT NULL,
  `provider` VARCHAR(256) NOT NULL,
  `model` VARCHAR(256) NOT NULL,
  `vector_space_id` VARCHAR(87),
  `dimension` INT,
  `created_by_subject_id` VARCHAR(255) NOT NULL,
  `failure_code` VARCHAR(64),
  `failure_message` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `activated_at` DATETIME(3),
  `superseded_at` DATETIME(3),
  `failed_at` DATETIME(3),
  CONSTRAINT `knowledge_space_profile_revisions_scope_revision_uq`
    UNIQUE (`tenant_id`, `knowledge_space_id`, `kind`, `revision`),
  CONSTRAINT `knowledge_space_profile_revisions_head_fk_uq`
    UNIQUE (`tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`),
  CONSTRAINT `knowledge_space_profile_revisions_attempt_fk_uq`
    UNIQUE (
      `tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`, `snapshot_digest`
    ),
  CONSTRAINT `knowledge_space_profile_revisions_kind_ck`
    CHECK (`kind` IN ('embedding', 'retrieval')),
  CONSTRAINT `knowledge_space_profile_revisions_state_ck`
    CHECK (`state` IN ('candidate', 'active', 'superseded', 'failed')),
  CONSTRAINT `knowledge_space_profile_revisions_positive_ck`
    CHECK (`revision` >= 1 AND (`dimension` IS NULL OR `dimension` >= 1)),
  CONSTRAINT `knowledge_space_profile_revisions_vector_shape_ck`
    CHECK (
      (
        `kind` = 'embedding'
        AND `vector_space_id` IS NOT NULL
        AND `dimension` IS NOT NULL
        AND `dimension` >= 1
      )
      OR (`kind` = 'retrieval' AND `vector_space_id` IS NULL AND `dimension` IS NULL)
    ),
  CONSTRAINT `knowledge_space_profile_revisions_lifecycle_ck`
    CHECK (
      (
        `state` = 'candidate'
        AND `activated_at` IS NULL AND `superseded_at` IS NULL AND `failed_at` IS NULL
        AND `failure_code` IS NULL AND `failure_message` IS NULL
      )
      OR (
        `state` = 'active'
        AND `activated_at` IS NOT NULL AND `superseded_at` IS NULL AND `failed_at` IS NULL
        AND `failure_code` IS NULL AND `failure_message` IS NULL
      )
      OR (
        `state` = 'superseded'
        AND `activated_at` IS NOT NULL AND `superseded_at` IS NOT NULL AND `failed_at` IS NULL
        AND `failure_code` IS NULL AND `failure_message` IS NULL
      )
      OR (
        `state` = 'failed'
        AND `activated_at` IS NULL AND `superseded_at` IS NULL AND `failed_at` IS NOT NULL
        AND `failure_code` IS NOT NULL AND `failure_message` IS NOT NULL
      )
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `knowledge_space_profile_revisions_scope_state_idx`
  ON `knowledge_space_profile_revisions` (
    `tenant_id`, `knowledge_space_id`, `kind`, `state`, `revision`, `id`
  );

CREATE TABLE IF NOT EXISTS `knowledge_space_profile_heads` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `profile_revision_id` CHAR(36) NOT NULL,
  `active_revision` INT NOT NULL,
  `row_version` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `knowledge_space_profile_heads_kind_ck`
    CHECK (`kind` IN ('embedding', 'retrieval')),
  CONSTRAINT `knowledge_space_profile_heads_positive_ck`
    CHECK (`active_revision` >= 1 AND `row_version` >= 1),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `kind`, `profile_revision_id`, `active_revision`
  ) REFERENCES `knowledge_space_profile_revisions` (
    `tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_profile_heads_scope_uq`
  ON `knowledge_space_profile_heads` (`tenant_id`, `knowledge_space_id`, `kind`);

-- The runtime discovers legacy manifest profiles in bounded keyset pages and records the exact
-- source snapshot here. Lease-token plus row-version fences prevent stale workers from activating
-- a profile after a manifest or deletion transition.
CREATE TABLE IF NOT EXISTS `knowledge_space_profile_backfills` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `source_manifest_version` INT NOT NULL,
  `source_snapshot` JSON NOT NULL,
  `source_snapshot_digest` CHAR(64) NOT NULL,
  `run_state` VARCHAR(16) NOT NULL,
  `execution_attempts` INT NOT NULL,
  `max_execution_attempts` INT NOT NULL,
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `heartbeat_at` DATETIME(3),
  `row_version` INT NOT NULL,
  `last_error_code` VARCHAR(64),
  `last_error_message` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  CONSTRAINT `knowledge_space_profile_backfills_kind_ck`
    CHECK (`kind` IN ('embedding', 'retrieval')),
  CONSTRAINT `knowledge_space_profile_backfills_state_ck`
    CHECK (`run_state` IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT `knowledge_space_profile_backfills_positive_ck`
    CHECK (
      `source_manifest_version` >= 1
      AND `execution_attempts` >= 0
      AND `max_execution_attempts` >= 1
      AND `execution_attempts` <= `max_execution_attempts`
      AND `row_version` >= 1
    ),
  CONSTRAINT `knowledge_space_profile_backfills_lease_ck`
    CHECK (
      (
        `run_state` = 'running'
        AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL
        AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL
      )
      OR (
        `run_state` <> 'running'
        AND `worker_id` IS NULL AND `lease_token` IS NULL
        AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL
      )
    ),
  CONSTRAINT `knowledge_space_profile_backfills_lifecycle_ck`
    CHECK (
      (
        `run_state` IN ('queued', 'running')
        AND `completed_at` IS NULL
        AND `last_error_code` IS NULL AND `last_error_message` IS NULL
      )
      OR (
        `run_state` = 'succeeded'
        AND `completed_at` IS NOT NULL
        AND `last_error_code` IS NULL AND `last_error_message` IS NULL
      )
      OR (
        `run_state` = 'failed'
        AND `completed_at` IS NOT NULL
        AND `last_error_code` IS NOT NULL AND `last_error_message` IS NOT NULL
      )
    ),
  CONSTRAINT `knowledge_space_profile_backfills_lease_token_ck`
    CHECK (
      `lease_token` IS NULL
      OR (
        `lease_token` REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
        AND `lease_token` <> '00000000-0000-0000-0000-000000000000'
      )
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_profile_backfills_source_uq`
  ON `knowledge_space_profile_backfills` (
    `tenant_id`, `knowledge_space_id`, `kind`,
    `source_manifest_version`, `source_snapshot_digest`
  );
CREATE INDEX IF NOT EXISTS `knowledge_space_profile_backfills_claim_idx`
  ON `knowledge_space_profile_backfills` (
    `run_state`, `lease_expires_at`, `updated_at`, `id`
  );
