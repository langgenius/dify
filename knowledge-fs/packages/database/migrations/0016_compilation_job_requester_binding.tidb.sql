-- Knowledge Platform schema migration
-- Migration id: 0016_compilation_job_requester_binding
-- Dialect: tidb

-- Public compilation-job control is bound to the exact durable permission provenance. NULL across
-- the full binding denotes legacy/internal attempts, which public handlers treat as inaccessible.
ALTER TABLE `document_compilation_attempts`
  ADD COLUMN IF NOT EXISTS `requested_by_subject_id` VARCHAR(255);
ALTER TABLE `document_compilation_attempts`
  ADD COLUMN IF NOT EXISTS `permission_snapshot_id` CHAR(36);
ALTER TABLE `document_compilation_attempts`
  ADD COLUMN IF NOT EXISTS `permission_snapshot_revision` INT;
ALTER TABLE `document_compilation_attempts`
  ADD COLUMN IF NOT EXISTS `access_channel` VARCHAR(16);

-- TiDB exposes CHECK constraints and foreign keys through distinct information_schema views.
-- Select the exact ALTER or a no-op so marker-loss replay never duplicates committed DDL.
SET @kfs_0016_compilation_permission_binding_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_permission_binding_ck'
  ),
  'DO 0',
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_permission_binding_ck` CHECK ((`requested_by_subject_id` IS NULL AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL AND `access_channel` IS NULL) OR (`requested_by_subject_id` IS NOT NULL AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1 AND `access_channel` IN (''interactive'', ''service_api'', ''mcp'', ''agent'')))'
);
PREPARE kfs_0016_compilation_permission_binding_stmt
  FROM @kfs_0016_compilation_permission_binding_sql;
EXECUTE kfs_0016_compilation_permission_binding_stmt;
DEALLOCATE PREPARE kfs_0016_compilation_permission_binding_stmt;

SET @kfs_0016_compilation_permission_snapshot_fk_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_permission_snapshot_fk'
  ),
  'DO 0',
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_permission_snapshot_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `permission_snapshot_id`, `requested_by_subject_id`, `access_channel`) REFERENCES `knowledge_space_permission_snapshots` (`tenant_id`, `knowledge_space_id`, `id`, `subject_id`, `access_channel`)'
);
PREPARE kfs_0016_compilation_permission_snapshot_fk_stmt
  FROM @kfs_0016_compilation_permission_snapshot_fk_sql;
EXECUTE kfs_0016_compilation_permission_snapshot_fk_stmt;
DEALLOCATE PREPARE kfs_0016_compilation_permission_snapshot_fk_stmt;
