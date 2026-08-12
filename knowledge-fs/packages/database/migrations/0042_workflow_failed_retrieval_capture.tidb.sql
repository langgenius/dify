-- Knowledge Platform schema migration
-- Migration id: 0042_workflow_failed_retrieval_capture
-- Dialect: tidb
-- Workflow empty-retrieval events retain their admitted Capability provenance and frozen scope.

ALTER TABLE `failed_queries`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL;

SET @fq_0042_binding_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'failed_queries'
    AND constraint_name = 'failed_queries_permission_binding_ck'
);
SET @fq_0042_binding_ck_drop_sql = IF(
  @fq_0042_binding_ck_exists > 0,
  'ALTER TABLE `failed_queries` DROP CONSTRAINT `failed_queries_permission_binding_ck`',
  'SELECT 1'
);
PREPARE fq_0042_binding_ck_drop_stmt FROM @fq_0042_binding_ck_drop_sql;
EXECUTE fq_0042_binding_ck_drop_stmt;
DEALLOCATE PREPARE fq_0042_binding_ck_drop_stmt;

ALTER TABLE `failed_queries`
  MODIFY COLUMN `permission_binding_complete` TINYINT GENERATED ALWAYS AS (
    CASE WHEN
      (`tenant_id` IS NULL AND `capability_grant_id` IS NULL
        AND `requested_by_subject_id` IS NULL AND `access_channel` IS NULL
        AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
        AND `required_permission_scope` IS NULL AND `revision` IS NULL)
      OR (`tenant_id` IS NOT NULL AND `capability_grant_id` IS NOT NULL
        AND `requested_by_subject_id` IS NULL AND `access_channel` IS NULL
        AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL
        AND `required_permission_scope` IS NOT NULL
        AND JSON_TYPE(`required_permission_scope`) = 'ARRAY'
        AND `revision` IS NOT NULL AND `revision` >= 1)
      OR (`tenant_id` IS NOT NULL AND `capability_grant_id` IS NULL
        AND `requested_by_subject_id` IS NOT NULL
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

ALTER TABLE `failed_queries`
  ADD CONSTRAINT `failed_queries_permission_binding_ck`
  CHECK (`permission_binding_complete` = 1);

SET @fq_0042_capability_fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'failed_queries'
    AND constraint_name = 'failed_queries_capability_grant_fk'
);
SET @fq_0042_capability_fk_sql = IF(
  @fq_0042_capability_fk_exists = 0,
  'ALTER TABLE `failed_queries` ADD CONSTRAINT `failed_queries_capability_grant_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`) REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE fq_0042_capability_fk_stmt FROM @fq_0042_capability_fk_sql;
EXECUTE fq_0042_capability_fk_stmt;
DEALLOCATE PREPARE fq_0042_capability_fk_stmt;

CREATE INDEX IF NOT EXISTS `failed_queries_capability_grant_idx`
  ON `failed_queries` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
