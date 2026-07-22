-- Knowledge Platform schema migration
-- Migration id: 0024_quality_control
-- Dialect: tidb
-- New-table-only DDL plus IF NOT EXISTS indexes keeps marker-loss replay safe.

CREATE UNIQUE INDEX IF NOT EXISTS `answer_traces_space_id_uq`
  ON `answer_traces` (`knowledge_space_id`, `id`);

CREATE TABLE IF NOT EXISTS `quality_replay_runs` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(255) NOT NULL,
  `request_fingerprint` VARCHAR(71) NOT NULL,
  `mode` VARCHAR(16) NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `requested_by_subject_id` VARCHAR(255) NOT NULL,
  `access_channel` VARCHAR(16) NOT NULL,
  `permission_snapshot_id` CHAR(36) NOT NULL,
  `permission_snapshot_revision` INT NOT NULL,
  `required_permission_scope` JSON NOT NULL,
  `frozen_snapshot` JSON NOT NULL,
  `revision` INT NOT NULL,
  `attempt` INT NOT NULL,
  `lease_owner` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `error_message` TEXT,
  `started_at` DATETIME(3),
  `completed_at` DATETIME(3),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `quality_replay_runs_state_ck` CHECK (
    `mode` IN ('fast', 'research', 'deep')
    AND `state` IN ('queued', 'running', 'passed', 'failed', 'canceled')
  ),
  CONSTRAINT `quality_replay_runs_lease_ck` CHECK (
    (`state` = 'running' AND `lease_owner` IS NOT NULL AND `lease_token` IS NOT NULL
      AND `lease_expires_at` IS NOT NULL AND `completed_at` IS NULL)
    OR (`state` <> 'running' AND `lease_owner` IS NULL AND `lease_token` IS NULL
      AND `lease_expires_at` IS NULL)
  ),
  CONSTRAINT `quality_replay_runs_terminal_ck` CHECK (
    (`state` IN ('passed', 'failed', 'canceled') AND `completed_at` IS NOT NULL)
    OR (`state` IN ('queued', 'running') AND `completed_at` IS NULL)
  ),
  CONSTRAINT `quality_replay_runs_revision_ck` CHECK (
    `revision` >= 1 AND `attempt` >= 0 AND `permission_snapshot_revision` >= 1
    AND `request_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT `quality_replay_runs_scope_json_ck`
    CHECK (JSON_TYPE(`required_permission_scope`) = 'ARRAY'),
  CONSTRAINT `quality_replay_runs_snapshot_json_ck`
    CHECK (JSON_TYPE(`frozen_snapshot`) = 'OBJECT'),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (
    `knowledge_space_id`, `permission_snapshot_id`, `requested_by_subject_id`, `access_channel`
  ) REFERENCES `knowledge_space_permission_snapshots` (
    `knowledge_space_id`, `id`, `subject_id`, `access_channel`
  ) ON DELETE RESTRICT,
  UNIQUE KEY `quality_replay_runs_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`)
);

CREATE UNIQUE INDEX IF NOT EXISTS `quality_replay_runs_scope_id_uq`
  ON `quality_replay_runs` (`tenant_id`, `knowledge_space_id`, `id`);
CREATE UNIQUE INDEX IF NOT EXISTS `quality_replay_runs_idempotency_uq`
  ON `quality_replay_runs` (`tenant_id`, `knowledge_space_id`, `idempotency_key`);
CREATE INDEX IF NOT EXISTS `quality_replay_runs_scope_created_idx`
  ON `quality_replay_runs` (`tenant_id`, `knowledge_space_id`, `created_at` DESC, `id` DESC);
CREATE INDEX IF NOT EXISTS `quality_replay_runs_claim_idx`
  ON `quality_replay_runs` (`state`, `lease_expires_at`, `created_at`, `id`);

CREATE TABLE IF NOT EXISTS `quality_replay_items` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `golden_question_id` CHAR(36) NOT NULL,
  `ordinal` INT NOT NULL,
  `question` TEXT NOT NULL,
  `expected_evidence_ids` JSON NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `result` JSON,
  `trace_id` CHAR(36),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `quality_replay_items_state_ck` CHECK (
    `ordinal` >= 1 AND `state` IN ('queued', 'running', 'passed', 'failed', 'canceled')
  ),
  CONSTRAINT `quality_replay_items_expected_json_ck`
    CHECK (JSON_TYPE(`expected_evidence_ids`) = 'ARRAY'),
  CONSTRAINT `quality_replay_items_result_json_ck`
    CHECK (`result` IS NULL OR JSON_TYPE(`result`) = 'OBJECT'),
  FOREIGN KEY (`run_id`) REFERENCES `quality_replay_runs` (`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `quality_replay_items_run_ordinal_uq`
  ON `quality_replay_items` (`run_id`, `ordinal`);
CREATE UNIQUE INDEX IF NOT EXISTS `quality_replay_items_run_golden_uq`
  ON `quality_replay_items` (`run_id`, `golden_question_id`);

CREATE TABLE IF NOT EXISTS `quality_replay_outbox` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `delivery_revision` INT NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `delivery_state` VARCHAR(16) NOT NULL,
  `attempt` INT NOT NULL,
  `lease_owner` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `delivered_at` DATETIME(3),
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `quality_replay_outbox_state_ck` CHECK (
    `delivery_revision` >= 1
    AND `delivery_state` IN ('pending', 'claimed', 'delivered') AND `attempt` >= 0
    AND ((`delivery_state` = 'claimed' AND `lease_owner` IS NOT NULL
      AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL
      AND `delivered_at` IS NULL)
    OR (`delivery_state` <> 'claimed' AND `lease_owner` IS NULL
      AND `lease_token` IS NULL AND `lease_expires_at` IS NULL))
    AND ((`delivery_state` = 'delivered' AND `delivered_at` IS NOT NULL)
      OR (`delivery_state` <> 'delivered' AND `delivered_at` IS NULL))
  ),
  FOREIGN KEY (`run_id`) REFERENCES `quality_replay_runs` (`id`) ON DELETE CASCADE
);
ALTER TABLE `quality_replay_outbox`
  ADD COLUMN IF NOT EXISTS `delivery_revision` INT;
UPDATE `quality_replay_outbox` AS outbox
INNER JOIN (
  SELECT `id`, ROW_NUMBER() OVER (
    PARTITION BY `run_id` ORDER BY `created_at`, `id`
  ) AS `delivery_revision`
  FROM `quality_replay_outbox`
) AS ranked_delivery ON ranked_delivery.`id` = outbox.`id`
SET outbox.`delivery_revision` = ranked_delivery.`delivery_revision`
WHERE outbox.`delivery_revision` IS NULL;
ALTER TABLE `quality_replay_outbox`
  MODIFY COLUMN `delivery_revision` INT NOT NULL;
SET @quality_outbox_revision_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'quality_replay_outbox'
    AND constraint_name = 'quality_replay_outbox_delivery_revision_ck'
);
SET @quality_outbox_revision_ck_sql = IF(
  @quality_outbox_revision_ck_exists = 0,
  'ALTER TABLE `quality_replay_outbox` ADD CONSTRAINT `quality_replay_outbox_delivery_revision_ck` CHECK (`delivery_revision` >= 1)',
  'SELECT 1'
);
PREPARE quality_outbox_revision_ck_stmt FROM @quality_outbox_revision_ck_sql;
EXECUTE quality_outbox_revision_ck_stmt;
DEALLOCATE PREPARE quality_outbox_revision_ck_stmt;
CREATE INDEX IF NOT EXISTS `quality_replay_outbox_claim_idx`
  ON `quality_replay_outbox` (`delivery_state`, `lease_expires_at`, `created_at`, `id`);
CREATE UNIQUE INDEX IF NOT EXISTS `quality_replay_outbox_run_delivery_uq`
  ON `quality_replay_outbox` (`run_id`, `delivery_revision`);
CREATE INDEX IF NOT EXISTS `quality_replay_outbox_run_idx`
  ON `quality_replay_outbox` (`run_id`, `delivery_state`, `id`);

CREATE TABLE IF NOT EXISTS `quality_bad_cases` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `trace_id` CHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `reason` TEXT NOT NULL,
  `tags` JSON NOT NULL,
  `replay_run_id` CHAR(36),
  `actor_subject_id` VARCHAR(255) NOT NULL,
  `revision` INT NOT NULL,
  `required_permission_scope` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `quality_bad_cases_state_ck` CHECK (
    `status` IN ('open', 'replaying', 'fixed', 'dismissed') AND `revision` >= 1
    AND (`status` <> 'replaying' OR `replay_run_id` IS NOT NULL)
  ),
  CONSTRAINT `quality_bad_cases_tags_json_ck` CHECK (JSON_TYPE(`tags`) = 'ARRAY'),
  CONSTRAINT `quality_bad_cases_scope_json_ck`
    CHECK (JSON_TYPE(`required_permission_scope`) = 'ARRAY'),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `quality_bad_cases_trace_scope_fk`
    FOREIGN KEY (`knowledge_space_id`, `trace_id`)
    REFERENCES `answer_traces` (`knowledge_space_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `replay_run_id`)
    REFERENCES `quality_replay_runs` (`tenant_id`, `knowledge_space_id`, `id`)
);
CREATE INDEX IF NOT EXISTS `quality_bad_cases_scope_status_idx`
  ON `quality_bad_cases` (`tenant_id`, `knowledge_space_id`, `status`, `created_at` DESC, `id` DESC);

CREATE TABLE IF NOT EXISTS `quality_missing_evidence_reviews` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `trace_id` CHAR(36) NOT NULL,
  `item_key` VARCHAR(71) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `reason` TEXT,
  `actor_subject_id` VARCHAR(255) NOT NULL,
  `revision` INT NOT NULL,
  `required_permission_scope` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `quality_missing_evidence_reviews_state_ck` CHECK (
    `status` IN ('active', 'dismissed') AND `revision` >= 1
    AND `item_key` REGEXP '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT `quality_missing_evidence_reviews_scope_json_ck`
    CHECK (JSON_TYPE(`required_permission_scope`) = 'ARRAY'),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `quality_missing_evidence_reviews_trace_scope_fk`
    FOREIGN KEY (`knowledge_space_id`, `trace_id`)
    REFERENCES `answer_traces` (`knowledge_space_id`, `id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `quality_missing_reviews_item_uq`
  ON `quality_missing_evidence_reviews` (
    `tenant_id`, `knowledge_space_id`, `trace_id`, `item_key`
  );

CREATE TABLE IF NOT EXISTS `quality_resource_history` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `aggregate_type` VARCHAR(32) NOT NULL,
  `aggregate_id` CHAR(36) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `actor_subject_id` VARCHAR(255) NOT NULL,
  `from_status` VARCHAR(16),
  `to_status` VARCHAR(16) NOT NULL,
  `reason` TEXT,
  `revision` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  CONSTRAINT `quality_resource_history_type_ck` CHECK (
    `aggregate_type` IN ('bad-case', 'missing-evidence') AND `revision` >= 1
  ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `quality_resource_history_revision_uq`
  ON `quality_resource_history` (
    `tenant_id`, `knowledge_space_id`, `aggregate_type`, `aggregate_id`, `revision`
  );

-- Legacy golden questions keep NULL provenance and are intentionally unreadable by public APIs.
ALTER TABLE `golden_questions`
  ADD COLUMN IF NOT EXISTS `tenant_id` VARCHAR(255),
  ADD COLUMN IF NOT EXISTS `required_permission_scope` JSON;
ALTER TABLE `golden_questions`
  ADD COLUMN IF NOT EXISTS `scope_binding_complete` TINYINT GENERATED ALWAYS AS (
    CASE WHEN
      (`tenant_id` IS NULL AND `required_permission_scope` IS NULL)
      OR (`tenant_id` IS NOT NULL AND `required_permission_scope` IS NOT NULL
        AND JSON_TYPE(`required_permission_scope`) = 'ARRAY')
      THEN 1 ELSE 0
    END
  ) VIRTUAL;

SET @golden_scope_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'golden_questions'
    AND constraint_name = 'golden_questions_scope_json_ck'
);
SET @golden_scope_ck_drop_sql = IF(
  @golden_scope_ck_exists > 0,
  'ALTER TABLE `golden_questions` DROP CONSTRAINT `golden_questions_scope_json_ck`',
  'SELECT 1'
);
PREPARE golden_scope_ck_drop_stmt FROM @golden_scope_ck_drop_sql;
EXECUTE golden_scope_ck_drop_stmt;
DEALLOCATE PREPARE golden_scope_ck_drop_stmt;
ALTER TABLE `golden_questions`
  ADD CONSTRAINT `golden_questions_scope_json_ck` CHECK (`scope_binding_complete` = 1);

SET @golden_scope_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'golden_questions'
    AND constraint_name = 'golden_questions_scope_fk'
);
SET @golden_scope_fk_sql = IF(
  @golden_scope_fk_exists = 0,
  'ALTER TABLE `golden_questions` ADD CONSTRAINT `golden_questions_scope_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`) REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE golden_scope_fk_stmt FROM @golden_scope_fk_sql;
EXECUTE golden_scope_fk_stmt;
DEALLOCATE PREPARE golden_scope_fk_stmt;

SET @quality_bad_trace_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'quality_bad_cases'
    AND constraint_name = 'quality_bad_cases_trace_scope_fk'
);
SET @quality_bad_trace_fk_sql = IF(
  @quality_bad_trace_fk_exists = 0,
  'ALTER TABLE `quality_bad_cases` ADD CONSTRAINT `quality_bad_cases_trace_scope_fk` FOREIGN KEY (`knowledge_space_id`, `trace_id`) REFERENCES `answer_traces` (`knowledge_space_id`, `id`) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE quality_bad_trace_fk_stmt FROM @quality_bad_trace_fk_sql;
EXECUTE quality_bad_trace_fk_stmt;
DEALLOCATE PREPARE quality_bad_trace_fk_stmt;

SET @quality_missing_trace_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'quality_missing_evidence_reviews'
    AND constraint_name = 'quality_missing_evidence_reviews_trace_scope_fk'
);
SET @quality_missing_trace_fk_sql = IF(
  @quality_missing_trace_fk_exists = 0,
  'ALTER TABLE `quality_missing_evidence_reviews` ADD CONSTRAINT `quality_missing_evidence_reviews_trace_scope_fk` FOREIGN KEY (`knowledge_space_id`, `trace_id`) REFERENCES `answer_traces` (`knowledge_space_id`, `id`) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE quality_missing_trace_fk_stmt FROM @quality_missing_trace_fk_sql;
EXECUTE quality_missing_trace_fk_stmt;
DEALLOCATE PREPARE quality_missing_trace_fk_stmt;

DROP INDEX IF EXISTS `golden_questions_space_id_idx` ON `golden_questions`;
CREATE INDEX IF NOT EXISTS `golden_questions_space_id_idx`
  ON `golden_questions` (`tenant_id`, `knowledge_space_id`, `id`);
DROP INDEX IF EXISTS `golden_questions_space_created_idx` ON `golden_questions`;
CREATE INDEX IF NOT EXISTS `golden_questions_space_created_idx`
  ON `golden_questions` (`tenant_id`, `knowledge_space_id`, `created_at`, `id`);

CREATE INDEX IF NOT EXISTS `failed_queries_space_created_idx`
  ON `failed_queries` (`knowledge_space_id`, `created_at`, `id`);

-- Legacy rows keep every provenance column NULL and are intentionally unreadable. New rows must
-- populate the complete binding. ADD COLUMN IF NOT EXISTS keeps marker-loss replay safe.
ALTER TABLE `failed_queries`
  ADD COLUMN IF NOT EXISTS `tenant_id` VARCHAR(255),
  ADD COLUMN IF NOT EXISTS `requested_by_subject_id` VARCHAR(255),
  ADD COLUMN IF NOT EXISTS `access_channel` VARCHAR(16),
  ADD COLUMN IF NOT EXISTS `permission_snapshot_id` CHAR(36),
  ADD COLUMN IF NOT EXISTS `permission_snapshot_revision` INT,
  ADD COLUMN IF NOT EXISTS `required_permission_scope` JSON,
  ADD COLUMN IF NOT EXISTS `revision` INT;
ALTER TABLE `failed_queries`
  ADD COLUMN IF NOT EXISTS `permission_binding_complete` TINYINT GENERATED ALWAYS AS (
    CASE WHEN
      (`tenant_id` IS NULL AND `requested_by_subject_id` IS NULL AND `access_channel` IS NULL
        AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
        AND `required_permission_scope` IS NULL AND `revision` IS NULL)
      OR (`tenant_id` IS NOT NULL AND `requested_by_subject_id` IS NOT NULL
        AND `access_channel` IS NOT NULL
        AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')
        AND `permission_snapshot_id` IS NOT NULL
        AND `permission_snapshot_revision` IS NOT NULL
        AND `permission_snapshot_revision` >= 1
        AND `required_permission_scope` IS NOT NULL
        AND JSON_TYPE(`required_permission_scope`) = 'ARRAY'
        AND `revision` IS NOT NULL AND `revision` >= 1)
      THEN 1 ELSE 0
    END
  ) VIRTUAL;

SET @fq_binding_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'failed_queries'
    AND constraint_name = 'failed_queries_permission_binding_ck'
);
SET @fq_binding_ck_drop_sql = IF(
  @fq_binding_ck_exists > 0,
  'ALTER TABLE `failed_queries` DROP CONSTRAINT `failed_queries_permission_binding_ck`',
  'SELECT 1'
);
PREPARE fq_binding_ck_drop_stmt FROM @fq_binding_ck_drop_sql;
EXECUTE fq_binding_ck_drop_stmt;
DEALLOCATE PREPARE fq_binding_ck_drop_stmt;
ALTER TABLE `failed_queries`
  ADD CONSTRAINT `failed_queries_permission_binding_ck`
  CHECK (`permission_binding_complete` = 1);

SET @fq_scope_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'failed_queries'
    AND constraint_name = 'failed_queries_scope_fk'
);
SET @fq_scope_fk_sql = IF(
  @fq_scope_fk_exists = 0,
  'ALTER TABLE `failed_queries` ADD CONSTRAINT `failed_queries_scope_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`) REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE fq_scope_fk_stmt FROM @fq_scope_fk_sql;
EXECUTE fq_scope_fk_stmt;
DEALLOCATE PREPARE fq_scope_fk_stmt;

SET @fq_permission_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'failed_queries'
    AND constraint_name = 'failed_queries_permission_snapshot_fk'
);
SET @fq_permission_fk_sql = IF(
  @fq_permission_fk_exists = 0,
  'ALTER TABLE `failed_queries` ADD CONSTRAINT `failed_queries_permission_snapshot_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `permission_snapshot_id`, `requested_by_subject_id`, `access_channel`) REFERENCES `knowledge_space_permission_snapshots` (`tenant_id`, `knowledge_space_id`, `id`, `subject_id`, `access_channel`)',
  'SELECT 1'
);
PREPARE fq_permission_fk_stmt FROM @fq_permission_fk_sql;
EXECUTE fq_permission_fk_stmt;
DEALLOCATE PREPARE fq_permission_fk_stmt;

CREATE INDEX IF NOT EXISTS `failed_queries_subject_created_idx`
  ON `failed_queries` (
    `tenant_id`, `knowledge_space_id`, `requested_by_subject_id`, `created_at`, `id`
  );
