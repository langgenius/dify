-- Knowledge Platform schema migration
-- Migration id: 0037_logical_document_zero_revision_deletion
-- Dialect: tidb

-- A logical document starts at row_version 0 and can fail before its first revision is activated.
-- Durable deletion already accepts that CAS value; keep other target revisions strictly positive.
-- TiDB DDL may commit before the migration marker. Guard each independent schema change so a
-- crash after either DROP can resume with the ADD, and marker loss after both ADDs can replay.
SET @kfs_0037_deletion_jobs_positive_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_jobs'
      AND constraint_name = 'deletion_jobs_positive_ck'
  ),
  'ALTER TABLE `deletion_jobs` DROP CHECK `deletion_jobs_positive_ck`',
  'DO 0'
);
PREPARE kfs_0037_deletion_jobs_positive_stmt
  FROM @kfs_0037_deletion_jobs_positive_sql;
EXECUTE kfs_0037_deletion_jobs_positive_stmt;
DEALLOCATE PREPARE kfs_0037_deletion_jobs_positive_stmt;

SET @kfs_0037_deletion_jobs_positive_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_jobs'
      AND constraint_name = 'deletion_jobs_positive_ck'
  ),
  'DO 0',
  'ALTER TABLE `deletion_jobs` ADD CONSTRAINT `deletion_jobs_positive_ck` CHECK (((`target_type` = ''logical_document'' AND `target_revision` >= 0) OR (`target_type` <> ''logical_document'' AND `target_revision` >= 1)) AND (`capability_grant_id` IS NOT NULL OR `permission_snapshot_revision` >= 1) AND `row_version` >= 1 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts` AND (`active_slot` IS NULL OR `active_slot` = 1))'
);
PREPARE kfs_0037_deletion_jobs_positive_stmt
  FROM @kfs_0037_deletion_jobs_positive_sql;
EXECUTE kfs_0037_deletion_jobs_positive_stmt;
DEALLOCATE PREPARE kfs_0037_deletion_jobs_positive_stmt;

SET @kfs_0037_deletion_tombstones_positive_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_tombstones'
      AND constraint_name = 'deletion_tombstones_positive_ck'
  ),
  'ALTER TABLE `deletion_tombstones` DROP CHECK `deletion_tombstones_positive_ck`',
  'DO 0'
);
PREPARE kfs_0037_deletion_tombstones_positive_stmt
  FROM @kfs_0037_deletion_tombstones_positive_sql;
EXECUTE kfs_0037_deletion_tombstones_positive_stmt;
DEALLOCATE PREPARE kfs_0037_deletion_tombstones_positive_stmt;

SET @kfs_0037_deletion_tombstones_positive_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'deletion_tombstones'
      AND constraint_name = 'deletion_tombstones_positive_ck'
  ),
  'DO 0',
  'ALTER TABLE `deletion_tombstones` ADD CONSTRAINT `deletion_tombstones_positive_ck` CHECK (((`target_type` = ''logical_document'' AND `target_revision` >= 0) OR (`target_type` <> ''logical_document'' AND `target_revision` >= 1)) AND `row_version` >= 1)'
);
PREPARE kfs_0037_deletion_tombstones_positive_stmt
  FROM @kfs_0037_deletion_tombstones_positive_sql;
EXECUTE kfs_0037_deletion_tombstones_positive_stmt;
DEALLOCATE PREPARE kfs_0037_deletion_tombstones_positive_stmt;
