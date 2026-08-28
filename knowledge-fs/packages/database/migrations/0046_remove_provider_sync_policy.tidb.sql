-- Knowledge Platform schema migration
-- Migration id: 0046_remove_provider_sync_policy
-- Dialect: tidb
-- Historical provider policies must be converted to manual before this migration runs.

SET @kfs_0046_source_sync_policies_mode_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'source_sync_policies'
    AND constraint_name = 'source_sync_policies_mode_ck'
);
SET @kfs_0046_source_sync_policies_mode_ck_drop_sql = IF(
  @kfs_0046_source_sync_policies_mode_ck_exists > 0,
  'ALTER TABLE `source_sync_policies` DROP CONSTRAINT `source_sync_policies_mode_ck`',
  'SELECT 1'
);
PREPARE kfs_0046_drop_mode_ck_stmt
  FROM @kfs_0046_source_sync_policies_mode_ck_drop_sql;
EXECUTE kfs_0046_drop_mode_ck_stmt;
DEALLOCATE PREPARE kfs_0046_drop_mode_ck_stmt;

ALTER TABLE `source_sync_policies`
  ADD CONSTRAINT `source_sync_policies_mode_ck`
  CHECK (`mode` IN ('manual', 'interval', 'custom'));
