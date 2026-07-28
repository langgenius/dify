-- Knowledge Platform schema migration
-- Migration id: 0031_source_connection_capability_provenance
-- Dialect: tidb
-- Integrated source connections persist only the admitted Capability grant locator. The bearer,
-- raw jti, Dify credential, and membership snapshot never cross this persistence boundary.

ALTER TABLE `source_connections`
  ADD COLUMN IF NOT EXISTS `capability_grant_id` CHAR(36) NULL;

SET @source_connection_capability_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'source_connections'
    AND constraint_name = 'source_connections_capability_grant_fk'
);
SET @source_connection_capability_fk_ddl = IF(
  @source_connection_capability_fk_exists = 0,
  'ALTER TABLE `source_connections` ADD CONSTRAINT `source_connections_capability_grant_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `capability_grant_id`) REFERENCES `capability_grants` (`tenant_id`, `knowledge_space_id`, `grant_id`) ON DELETE RESTRICT',
  'DO 0'
);
PREPARE source_connection_capability_fk_statement
  FROM @source_connection_capability_fk_ddl;
EXECUTE source_connection_capability_fk_statement;
DEALLOCATE PREPARE source_connection_capability_fk_statement;

CREATE INDEX IF NOT EXISTS `source_connections_capability_grant_idx`
  ON `source_connections` (`tenant_id`, `knowledge_space_id`, `capability_grant_id`);
