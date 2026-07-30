-- Knowledge Platform schema migration
-- Migration id: 0034_knowledge_space_emoji_icons
-- Dialect: tidb
-- Dify persists bounded Emoji Mart identities while retaining the legacy builtin-prefixed form.
-- TiDB DDL may commit before the migration marker, so both replacement steps are replay safe.

SET @kfs_0034_icon_constraint_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'knowledge_spaces'
      AND constraint_name = 'knowledge_spaces_icon_ref_ck'
  ),
  'ALTER TABLE `knowledge_spaces` DROP CHECK `knowledge_spaces_icon_ref_ck`',
  'DO 0'
);
PREPARE kfs_0034_icon_constraint_stmt FROM @kfs_0034_icon_constraint_sql;
EXECUTE kfs_0034_icon_constraint_stmt;
DEALLOCATE PREPARE kfs_0034_icon_constraint_stmt;

SET @kfs_0034_icon_constraint_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'knowledge_spaces'
      AND constraint_name = 'knowledge_spaces_icon_ref_ck'
  ),
  'DO 0',
  'ALTER TABLE `knowledge_spaces` ADD CONSTRAINT `knowledge_spaces_icon_ref_ck` CHECK (`icon_ref` IS NULL OR `icon_ref` REGEXP ''^(builtin:)?[+a-z0-9_-]{1,64}$'')'
);
PREPARE kfs_0034_icon_constraint_stmt FROM @kfs_0034_icon_constraint_sql;
EXECUTE kfs_0034_icon_constraint_stmt;
DEALLOCATE PREPARE kfs_0034_icon_constraint_stmt;
