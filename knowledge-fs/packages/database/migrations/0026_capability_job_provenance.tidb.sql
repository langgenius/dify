-- Knowledge Platform schema migration
-- Migration id: 0026_capability_job_provenance
-- Dialect: tidb
-- Capability jobs persist only a grant locator. Nullable snapshot columns remain for rollback and
-- already-durable legacy rows; no bearer token, raw jti, or Dify membership snapshot is stored.

ALTER TABLE `research_task_jobs`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  ADD CONSTRAINT `research_task_jobs_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `access_channel` IS NULL)
    OR (`capability_grant_id` IS NULL AND `subject_id` IS NOT NULL
      AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1
      AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))
  ),
  ADD CONSTRAINT `research_task_jobs_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `answer_traces`
  ADD COLUMN IF NOT EXISTS `tenant_id` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  DROP CONSTRAINT `answer_traces_permission_snapshot_binding_ck`,
  ADD CONSTRAINT `answer_traces_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `tenant_id` IS NOT NULL AND `subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `access_channel` IS NULL)
    OR (`capability_grant_id` IS NULL AND (
      (`permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
        AND `access_channel` IS NULL)
      OR (`subject_id` IS NOT NULL AND `permission_snapshot_id` IS NOT NULL
        AND `permission_snapshot_revision` >= 1
        AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))))
  ),
  ADD CONSTRAINT `answer_traces_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `document_compilation_attempts`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  DROP CONSTRAINT `document_compilation_attempts_permission_binding_ck`,
  ADD CONSTRAINT `document_compilation_attempts_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `requested_by_subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `access_channel` IS NULL)
    OR (`capability_grant_id` IS NULL AND (
      (`requested_by_subject_id` IS NULL AND `permission_snapshot_id` IS NULL
        AND `permission_snapshot_revision` IS NULL AND `access_channel` IS NULL)
      OR (`requested_by_subject_id` IS NOT NULL AND `permission_snapshot_id` IS NOT NULL
        AND `permission_snapshot_revision` >= 1
        AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))))
  ),
  ADD CONSTRAINT `document_compilation_attempts_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `document_revisions`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  ADD CONSTRAINT `document_revisions_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `knowledge_space_profile_migration_runs`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `requested_by_subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  DROP CONSTRAINT `knowledge_space_profile_migration_runs_positive_ck`,
  ADD CONSTRAINT `knowledge_space_profile_migration_runs_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `requested_by_subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `access_channel` IS NULL)
    OR (`capability_grant_id` IS NULL AND `requested_by_subject_id` IS NOT NULL
      AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1
      AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))
  ),
  ADD CONSTRAINT `knowledge_space_profile_migration_runs_positive_ck` CHECK (
    `candidate_profile_revision` >= 1 AND `base_retrieval_profile_revision` >= 1
    AND `base_publication_head_revision` >= 1
    AND (`capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1)
    AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1
    AND `execution_attempts` <= `max_execution_attempts` AND `row_version` >= 1
    AND (`active_slot` IS NULL OR `active_slot` = 1)
  ),
  ADD CONSTRAINT `knowledge_space_profile_migration_runs_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `source_workflow_runs`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `requested_by_subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `required_permission_scope` JSON NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  DROP CONSTRAINT `source_workflow_runs_nonnegative_ck`,
  ADD CONSTRAINT `source_workflow_runs_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `requested_by_subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `required_permission_scope` IS NULL AND `access_channel` IS NULL)
    OR (`capability_grant_id` IS NULL AND `requested_by_subject_id` IS NOT NULL
      AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1
      AND `required_permission_scope` IS NOT NULL
      AND JSON_TYPE(`required_permission_scope`) = 'ARRAY'
      AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))
  ),
  ADD CONSTRAINT `source_workflow_runs_nonnegative_ck` CHECK (
    `progress_completed` >= 0 AND `progress_skipped` >= 0 AND `progress_failed` >= 0
    AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1
    AND `execution_attempts` <= `max_execution_attempts`
    AND (`capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1)
    AND `row_version` >= 1 AND (`active_slot` IS NULL OR `active_slot` = 1)
  ),
  ADD CONSTRAINT `source_workflow_runs_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `quality_replay_runs`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `requested_by_subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `required_permission_scope` JSON NULL,
  DROP CONSTRAINT `quality_replay_runs_revision_ck`,
  ADD CONSTRAINT `quality_replay_runs_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `requested_by_subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `required_permission_scope` IS NULL AND `access_channel` IS NULL)
    OR (`capability_grant_id` IS NULL AND `requested_by_subject_id` IS NOT NULL
      AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1
      AND `required_permission_scope` IS NOT NULL
      AND JSON_TYPE(`required_permission_scope`) = 'ARRAY'
      AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))
  ),
  ADD CONSTRAINT `quality_replay_runs_revision_ck` CHECK (
    `revision` >= 1 AND `attempt` >= 0
    AND (`capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1)
    AND `request_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT `quality_replay_runs_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `deletion_jobs`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `requested_by_subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  DROP CONSTRAINT `deletion_jobs_positive_ck`,
  ADD CONSTRAINT `deletion_jobs_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `requested_by_subject_id` IS NULL
      AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
      AND `access_channel` IS NULL AND `api_key_id` IS NULL
      AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL)
    OR (`capability_grant_id` IS NULL AND `requested_by_subject_id` IS NOT NULL
      AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1
      AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))
  ),
  ADD CONSTRAINT `deletion_jobs_positive_ck` CHECK (
    `target_revision` >= 1
    AND (`capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1)
    AND `row_version` >= 1 AND `execution_attempts` >= 0
    AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts`
    AND (`active_slot` IS NULL OR `active_slot` = 1)
  ),
  ADD CONSTRAINT `deletion_jobs_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

ALTER TABLE `deletion_retry_audits`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `actor_subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  DROP CONSTRAINT `deletion_retry_audits_positive_ck`,
  DROP CONSTRAINT `deletion_retry_audits_owner_rescue_ck`,
  ADD CONSTRAINT `deletion_retry_audits_authorization_binding_ck` CHECK (
    (`capability_grant_id` IS NOT NULL AND `retry_authority` = 'original_requester'
      AND `actor_subject_id` IS NULL AND `permission_snapshot_id` IS NULL
      AND `permission_snapshot_revision` IS NULL AND `access_channel` IS NULL
      AND `api_key_id` IS NULL AND `api_key_revision` IS NULL
      AND `api_key_expires_at` IS NULL)
    OR (`capability_grant_id` IS NULL AND `actor_subject_id` IS NOT NULL
      AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1
      AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))
  ),
  ADD CONSTRAINT `deletion_retry_audits_positive_ck` CHECK (
    `capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1
  ),
  ADD CONSTRAINT `deletion_retry_audits_owner_rescue_ck` CHECK (
    `retry_authority` <> 'interactive_owner_rescue'
    OR (`access_channel` = 'interactive' AND `api_key_id` IS NULL
      AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL)
  ),
  ADD CONSTRAINT `deletion_retry_audits_capability_grant_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`)
    REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS `research_task_jobs_capability_grant_idx`
  ON `research_task_jobs` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `answer_traces_capability_grant_idx`
  ON `answer_traces` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `document_compilation_attempts_capability_grant_idx`
  ON `document_compilation_attempts` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `document_revisions_capability_grant_idx`
  ON `document_revisions` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `knowledge_space_profile_migration_runs_capability_grant_idx`
  ON `knowledge_space_profile_migration_runs` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `source_workflow_runs_capability_grant_idx`
  ON `source_workflow_runs` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `quality_replay_runs_capability_grant_idx`
  ON `quality_replay_runs` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `deletion_jobs_capability_grant_idx`
  ON `deletion_jobs` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
CREATE INDEX IF NOT EXISTS `deletion_retry_audits_capability_grant_idx`
  ON `deletion_retry_audits` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
