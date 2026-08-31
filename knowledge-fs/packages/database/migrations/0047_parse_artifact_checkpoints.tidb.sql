-- Knowledge Platform schema migration
-- Migration id: 0047_parse_artifact_checkpoints
-- Dialect: tidb
-- Persists raw parser output across compilation retries without exposing it as canonical content.

CREATE TABLE IF NOT EXISTS `parse_artifact_checkpoints` (
  `document_asset_id` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `policy_fingerprint` VARCHAR(64) NOT NULL,
  `artifact` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `parse_artifact_checkpoints_asset_fk`
    FOREIGN KEY (`document_asset_id`)
    REFERENCES `document_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `parse_artifact_checkpoints_version_ck`
    CHECK (`version` >= 1),
  CONSTRAINT `parse_artifact_checkpoints_policy_fingerprint_ck`
    CHECK (`policy_fingerprint` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `parse_artifact_checkpoints_artifact_ck`
    CHECK (JSON_TYPE(`artifact`) = 'OBJECT')
);

CREATE UNIQUE INDEX IF NOT EXISTS `parse_artifact_checkpoints_asset_version_uq`
  ON `parse_artifact_checkpoints` (`document_asset_id`, `version`);
