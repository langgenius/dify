-- Knowledge Platform schema migration
-- Migration id: 0013_space_access_control
-- Dialect: tidb

-- Skip all existing ACL table DDL on crash replay. TiDB revalidates inbound as well as
-- outbound foreign keys for CREATE TABLE IF NOT EXISTS and can otherwise reject a valid schema.
SET @acl_members_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'knowledge_space_members'
);
SET @acl_members_ddl = IF(
  @acl_members_exists = 0,
  'CREATE TABLE IF NOT EXISTS `knowledge_space_members` (   `id` CHAR(36) PRIMARY KEY NOT NULL,   `tenant_id` VARCHAR(255) NOT NULL,   `knowledge_space_id` CHAR(36) NOT NULL,   `subject_id` VARCHAR(255) NOT NULL,   `role` VARCHAR(16) NOT NULL,   `revision` INT NOT NULL,   `created_by_subject_id` VARCHAR(255) NOT NULL,   `created_at` DATETIME(3) NOT NULL,   `updated_at` DATETIME(3) NOT NULL,   CONSTRAINT `knowledge_space_members_role_ck`     CHECK (`role` IN (''owner'', ''editor'', ''viewer'')),   CONSTRAINT `knowledge_space_members_revision_ck` CHECK (`revision` >= 1),   CONSTRAINT `knowledge_space_members_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`)     REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE );',
  'DO 0'
);
PREPARE acl_members_statement FROM @acl_members_ddl;
EXECUTE acl_members_statement;
DEALLOCATE PREPARE acl_members_statement;

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_members_scope_subject_uq`
  ON `knowledge_space_members` (`tenant_id`, `knowledge_space_id`, `subject_id`);
CREATE INDEX IF NOT EXISTS `knowledge_space_members_scope_role_idx`
  ON `knowledge_space_members` (
    `tenant_id`, `knowledge_space_id`, `role`, `subject_id`, `id`
  );

-- TiDB validates foreign keys even for an existing CREATE TABLE IF NOT EXISTS and can reject a
-- crash replay after the referenced composite index was created separately. Skip the table DDL
-- entirely once it exists; the migration ledger still makes the normal path execute it exactly once.
SET @acl_access_policies_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'knowledge_space_access_policies'
);
SET @acl_access_policies_ddl = IF(
  @acl_access_policies_exists = 0,
  'CREATE TABLE IF NOT EXISTS `knowledge_space_access_policies` (   `id` CHAR(36) PRIMARY KEY NOT NULL,   `tenant_id` VARCHAR(255) NOT NULL,   `knowledge_space_id` CHAR(36) NOT NULL,   `visibility` VARCHAR(24) NOT NULL,   `owner_subject_id` VARCHAR(255) NOT NULL,   `revision` INT NOT NULL,   `updated_by_subject_id` VARCHAR(255) NOT NULL,   `created_at` DATETIME(3) NOT NULL,   `updated_at` DATETIME(3) NOT NULL,   CONSTRAINT `knowledge_space_access_policies_visibility_ck`     CHECK (`visibility` IN (''only_me'', ''all_members'', ''partial_members'')),   CONSTRAINT `knowledge_space_access_policies_revision_ck` CHECK (`revision` >= 1),   CONSTRAINT `knowledge_space_access_policies_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`)     REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,   CONSTRAINT `knowledge_space_access_policies_owner_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `owner_subject_id`)     REFERENCES `knowledge_space_members` (`tenant_id`, `knowledge_space_id`, `subject_id`)     ON DELETE RESTRICT );',
  'DO 0'
);
PREPARE acl_access_policies_statement FROM @acl_access_policies_ddl;
EXECUTE acl_access_policies_statement;
DEALLOCATE PREPARE acl_access_policies_statement;

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_access_policies_scope_uq`
  ON `knowledge_space_access_policies` (`tenant_id`, `knowledge_space_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_access_policies_scope_id_uq`
  ON `knowledge_space_access_policies` (`tenant_id`, `knowledge_space_id`, `id`);

-- TiDB validates foreign keys even for an existing CREATE TABLE IF NOT EXISTS and can reject a
-- crash replay after the referenced composite index was created separately. Skip the table DDL
-- entirely once it exists; the migration ledger still makes the normal path execute it exactly once.
SET @acl_access_policy_members_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'knowledge_space_access_policy_members'
);
SET @acl_access_policy_members_ddl = IF(
  @acl_access_policy_members_exists = 0,
  'CREATE TABLE IF NOT EXISTS `knowledge_space_access_policy_members` (   `id` CHAR(36) PRIMARY KEY NOT NULL,   `tenant_id` VARCHAR(255) NOT NULL,   `knowledge_space_id` CHAR(36) NOT NULL,   `access_policy_id` CHAR(36) NOT NULL,   `subject_id` VARCHAR(255) NOT NULL,   `created_at` DATETIME(3) NOT NULL,   CONSTRAINT `knowledge_space_access_policy_members_policy_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `access_policy_id`)     REFERENCES `knowledge_space_access_policies` (`tenant_id`, `knowledge_space_id`, `id`)     ON DELETE CASCADE,   CONSTRAINT `knowledge_space_access_policy_members_member_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `subject_id`)     REFERENCES `knowledge_space_members` (`tenant_id`, `knowledge_space_id`, `subject_id`)     ON DELETE CASCADE );',
  'DO 0'
);
PREPARE acl_access_policy_members_statement FROM @acl_access_policy_members_ddl;
EXECUTE acl_access_policy_members_statement;
DEALLOCATE PREPARE acl_access_policy_members_statement;

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_access_policy_members_policy_subject_uq`
  ON `knowledge_space_access_policy_members` (`access_policy_id`, `subject_id`);
CREATE INDEX IF NOT EXISTS `knowledge_space_access_policy_members_scope_subject_idx`
  ON `knowledge_space_access_policy_members` (
    `tenant_id`, `knowledge_space_id`, `subject_id`, `access_policy_id`
  );

-- Skip all existing ACL table DDL on crash replay. TiDB revalidates inbound as well as
-- outbound foreign keys for CREATE TABLE IF NOT EXISTS and can otherwise reject a valid schema.
SET @acl_api_access_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'knowledge_space_api_access'
);
SET @acl_api_access_ddl = IF(
  @acl_api_access_exists = 0,
  'CREATE TABLE IF NOT EXISTS `knowledge_space_api_access` (   `id` CHAR(36) PRIMARY KEY NOT NULL,   `tenant_id` VARCHAR(255) NOT NULL,   `knowledge_space_id` CHAR(36) NOT NULL,   `enabled` BOOLEAN NOT NULL,   `disabled_at` DATETIME(3),   `revision` INT NOT NULL,   `updated_by_subject_id` VARCHAR(255) NOT NULL,   `created_at` DATETIME(3) NOT NULL,   `updated_at` DATETIME(3) NOT NULL,   CONSTRAINT `knowledge_space_api_access_revision_ck` CHECK (`revision` >= 1),   CONSTRAINT `knowledge_space_api_access_disabled_ck` CHECK (     (`enabled` AND `disabled_at` IS NULL)     OR (NOT `enabled` AND `disabled_at` IS NOT NULL)   ),   CONSTRAINT `knowledge_space_api_access_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`)     REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE );',
  'DO 0'
);
PREPARE acl_api_access_statement FROM @acl_api_access_ddl;
EXECUTE acl_api_access_statement;
DEALLOCATE PREPARE acl_api_access_statement;

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_api_access_scope_uq`
  ON `knowledge_space_api_access` (`tenant_id`, `knowledge_space_id`);

-- TiDB validates foreign keys even for an existing CREATE TABLE IF NOT EXISTS and can reject a
-- crash replay after the referenced composite index was created separately. Skip the table DDL
-- entirely once it exists; the migration ledger still makes the normal path execute it exactly once.
SET @acl_api_keys_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'knowledge_space_api_keys'
);
SET @acl_api_keys_ddl = IF(
  @acl_api_keys_exists = 0,
  'CREATE TABLE IF NOT EXISTS `knowledge_space_api_keys` (   `id` CHAR(36) PRIMARY KEY NOT NULL,   `tenant_id` VARCHAR(255) NOT NULL,   `knowledge_space_id` CHAR(36) NOT NULL,   `name` VARCHAR(160) NOT NULL,   `key_prefix` VARCHAR(24) NOT NULL,   `key_hash` VARCHAR(64) NOT NULL,   `principal_subject_id` VARCHAR(255) NOT NULL,   `status` VARCHAR(16) NOT NULL,   `revision` INT NOT NULL,   `created_by_subject_id` VARCHAR(255) NOT NULL,   `last_used_at` DATETIME(3),   `expires_at` DATETIME(3),   `revoked_at` DATETIME(3),   `created_at` DATETIME(3) NOT NULL,   `updated_at` DATETIME(3) NOT NULL,   CONSTRAINT `knowledge_space_api_keys_status_ck`     CHECK (`status` IN (''active'', ''revoked'')),   CONSTRAINT `knowledge_space_api_keys_revision_ck` CHECK (`revision` >= 1),   CONSTRAINT `knowledge_space_api_keys_revocation_ck` CHECK (     (`status` = ''active'' AND `revoked_at` IS NULL)     OR (`status` = ''revoked'' AND `revoked_at` IS NOT NULL)   ),   CONSTRAINT `knowledge_space_api_keys_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`)     REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,   CONSTRAINT `knowledge_space_api_keys_principal_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `principal_subject_id`)     REFERENCES `knowledge_space_members` (`tenant_id`, `knowledge_space_id`, `subject_id`)     ON DELETE CASCADE );',
  'DO 0'
);
PREPARE acl_api_keys_statement FROM @acl_api_keys_ddl;
EXECUTE acl_api_keys_statement;
DEALLOCATE PREPARE acl_api_keys_statement;

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_api_keys_hash_uq`
  ON `knowledge_space_api_keys` (`key_hash`);
CREATE INDEX IF NOT EXISTS `knowledge_space_api_keys_scope_status_idx`
  ON `knowledge_space_api_keys` (
    `tenant_id`, `knowledge_space_id`, `status`, `created_at`, `id`
  );
CREATE INDEX IF NOT EXISTS `knowledge_space_api_keys_scope_created_idx`
  ON `knowledge_space_api_keys` (
    `tenant_id`, `knowledge_space_id`, `created_at`, `id`
  );

-- Skip all existing ACL table DDL on crash replay. TiDB revalidates inbound as well as
-- outbound foreign keys for CREATE TABLE IF NOT EXISTS and can otherwise reject a valid schema.
SET @acl_permission_snapshots_exists = (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'knowledge_space_permission_snapshots'
);
SET @acl_permission_snapshots_ddl = IF(
  @acl_permission_snapshots_exists = 0,
  'CREATE TABLE IF NOT EXISTS `knowledge_space_permission_snapshots` (   `id` CHAR(36) PRIMARY KEY NOT NULL,   `tenant_id` VARCHAR(255) NOT NULL,   `knowledge_space_id` CHAR(36) NOT NULL,   `subject_id` VARCHAR(255) NOT NULL,   `role` VARCHAR(16) NOT NULL,   `visibility` VARCHAR(24) NOT NULL,   `access_channel` VARCHAR(16) NOT NULL,   `member_revision` INT NOT NULL,   `access_policy_revision` INT NOT NULL,   `api_access_revision` INT NOT NULL,   `permission_scopes` JSON NOT NULL,   `status` VARCHAR(16) NOT NULL,   `revision` INT NOT NULL,   `expires_at` DATETIME(3) NOT NULL,   `revoked_at` DATETIME(3),   `created_at` DATETIME(3) NOT NULL,   `updated_at` DATETIME(3) NOT NULL,   CONSTRAINT `knowledge_space_permission_snapshots_role_ck`     CHECK (`role` IN (''owner'', ''editor'', ''viewer'')),   CONSTRAINT `knowledge_space_permission_snapshots_visibility_ck`     CHECK (`visibility` IN (''only_me'', ''all_members'', ''partial_members'')),   CONSTRAINT `knowledge_space_permission_snapshots_channel_ck`     CHECK (`access_channel` IN (''interactive'', ''service_api'', ''mcp'', ''agent'')),   CONSTRAINT `knowledge_space_permission_snapshots_status_ck`     CHECK (`status` IN (''active'', ''revoked'', ''expired'')),   CONSTRAINT `knowledge_space_permission_snapshots_revisions_ck` CHECK (     `revision` >= 1     AND `member_revision` >= 1     AND `access_policy_revision` >= 1     AND `api_access_revision` >= 1   ),   CONSTRAINT `knowledge_space_permission_snapshots_revocation_ck` CHECK (     (`status` = ''revoked'' AND `revoked_at` IS NOT NULL)     OR (`status` <> ''revoked'' AND `revoked_at` IS NULL)   ),   CONSTRAINT `knowledge_space_permission_snapshots_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`)     REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE );',
  'DO 0'
);
PREPARE acl_permission_snapshots_statement FROM @acl_permission_snapshots_ddl;
EXECUTE acl_permission_snapshots_statement;
DEALLOCATE PREPARE acl_permission_snapshots_statement;

CREATE INDEX IF NOT EXISTS `knowledge_space_permission_snapshots_scope_subject_idx`
  ON `knowledge_space_permission_snapshots` (
    `tenant_id`, `knowledge_space_id`, `subject_id`, `status`, `expires_at`, `id`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_permission_snapshots_scope_id_uq`
  ON `knowledge_space_permission_snapshots` (`tenant_id`, `knowledge_space_id`, `id`);
