-- Knowledge Platform schema migration
-- Migration id: 0032_capability_source_sync_policies
-- Dialect: tidb
-- Allows durable source sync policies to retain either a Capability grant or legacy ACL snapshot.

ALTER TABLE `source_sync_policies`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL,
  MODIFY COLUMN `requested_by_subject_id` VARCHAR(255) NULL,
  MODIFY COLUMN `access_channel` VARCHAR(16) NULL,
  MODIFY COLUMN `permission_snapshot_id` CHAR(36) NULL,
  MODIFY COLUMN `permission_snapshot_revision` INT NULL,
  MODIFY COLUMN `required_permission_scope` JSON NULL,
  DROP CONSTRAINT `source_sync_policies_channel_ck`,
  DROP CONSTRAINT `source_sync_policies_revision_ck`,
  ADD CONSTRAINT `source_sync_policies_channel_ck` CHECK (
    `access_channel` IS NULL
    OR `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  ADD CONSTRAINT `source_sync_policies_revision_ck` CHECK (
    `revision` >= 1 AND `expected_source_version` >= 1
    AND (`capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1)
  );

SET @kfs_0032_source_sync_policy_authorization_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'source_sync_policies'
      AND constraint_name = 'source_sync_policies_authorization_binding_ck'
  ),
  'DO 0',
  'ALTER TABLE `source_sync_policies` ADD CONSTRAINT `source_sync_policies_authorization_binding_ck` CHECK ((`capability_grant_id` IS NOT NULL AND `requested_by_subject_id` IS NULL AND `access_channel` IS NULL AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL AND `required_permission_scope` IS NULL) OR (`capability_grant_id` IS NULL AND `requested_by_subject_id` IS NOT NULL AND `access_channel` IN (''interactive'', ''service_api'', ''mcp'', ''agent'') AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1 AND `required_permission_scope` IS NOT NULL AND JSON_TYPE(`required_permission_scope`) = ''ARRAY''))'
);
PREPARE kfs_0032_source_sync_policy_authorization_stmt
  FROM @kfs_0032_source_sync_policy_authorization_sql;
EXECUTE kfs_0032_source_sync_policy_authorization_stmt;
DEALLOCATE PREPARE kfs_0032_source_sync_policy_authorization_stmt;

SET @kfs_0032_source_sync_policy_capability_fk_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'source_sync_policies'
      AND constraint_name = 'source_sync_policies_capability_grant_fk'
  ),
  'DO 0',
  'ALTER TABLE `source_sync_policies` ADD CONSTRAINT `source_sync_policies_capability_grant_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`) REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`) ON DELETE RESTRICT'
);
PREPARE kfs_0032_source_sync_policy_capability_fk_stmt
  FROM @kfs_0032_source_sync_policy_capability_fk_sql;
EXECUTE kfs_0032_source_sync_policy_capability_fk_stmt;
DEALLOCATE PREPARE kfs_0032_source_sync_policy_capability_fk_stmt;

CREATE INDEX IF NOT EXISTS `source_sync_policies_capability_grant_idx`
  ON `source_sync_policies` (
    `tenant_id`, `knowledge_space_id`, `capability_grant_id`
  );
