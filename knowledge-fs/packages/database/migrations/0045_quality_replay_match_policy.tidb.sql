-- Knowledge Platform schema migration
-- Migration id: 0045_quality_replay_match_policy
-- Dialect: tidb
-- Freezes each golden question's evidence match policy into durable quality replay items.

ALTER TABLE `quality_replay_items`
  ADD COLUMN IF NOT EXISTS `match_policy` VARCHAR(8);

UPDATE `quality_replay_items`
SET `match_policy` = 'all'
WHERE `match_policy` IS NULL;

ALTER TABLE `quality_replay_items`
  MODIFY COLUMN `match_policy` VARCHAR(8) NOT NULL;

SET @qr_0045_match_policy_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'quality_replay_items'
    AND constraint_name = 'quality_replay_items_match_policy_ck'
);
SET @qr_0045_match_policy_ck_drop_sql = IF(
  @qr_0045_match_policy_ck_exists > 0,
  'ALTER TABLE `quality_replay_items` DROP CONSTRAINT `quality_replay_items_match_policy_ck`',
  'SELECT 1'
);
PREPARE qr_0045_match_policy_ck_drop_stmt FROM @qr_0045_match_policy_ck_drop_sql;
EXECUTE qr_0045_match_policy_ck_drop_stmt;
DEALLOCATE PREPARE qr_0045_match_policy_ck_drop_stmt;

ALTER TABLE `quality_replay_items`
  ADD CONSTRAINT `quality_replay_items_match_policy_ck`
  CHECK (`match_policy` IN ('all', 'any'));
