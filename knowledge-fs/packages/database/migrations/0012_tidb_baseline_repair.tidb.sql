-- Knowledge Platform schema migration
-- Migration id: 0012_tidb_baseline_repair
-- Dialect: tidb

-- The pre-release TiDB artifacts 0001, 0002, 0004, 0006, and 0007 originally contained key TEXT
-- columns, unsupported JSON/expression/FULLTEXT indexes, and CHECK constraints that TiDB cannot
-- combine with foreign-key referential actions. Their checked-in clean-install definitions were
-- corrected before the first supported production release. This forward migration gives any
-- environment that nevertheless recorded those historical ids the same final schema.
--
-- There is deliberately no DELETE, truncation, or duplicate merge here. VARCHAR narrowing aborts
-- on an overlong value, repair guard indexes abort on conflicting logical identities, and repaired
-- foreign keys abort on orphaned data. Operators must reconcile incompatible data explicitly and
-- rerun the migration; a failed run is never recorded in schema_migrations.

-- TiDB rejects CHECK constraints on columns participating in a foreign-key referential action.
-- Older artifacts could only retain these checks when the corresponding foreign key was ignored or
-- invalid. Drop just those known incompatible checks, using information_schema so the repair is
-- safe to rerun and also remains a no-op on a corrected clean install.
SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_document_version_ck'
  ),
  'ALTER TABLE `document_compilation_attempts` DROP CONSTRAINT `document_compilation_attempts_document_version_ck`',
  'DO 0'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_candidate_pair_ck'
  ),
  'ALTER TABLE `document_compilation_attempts` DROP CONSTRAINT `document_compilation_attempts_candidate_pair_ck`',
  'DO 0'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_candidate_checkpoint_ck'
  ),
  'ALTER TABLE `document_compilation_attempts` DROP CONSTRAINT `document_compilation_attempts_candidate_checkpoint_ck`',
  'DO 0'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

-- Every column below either participates in a TiDB key/foreign key or has a bounded application
-- invariant. TiDB fails ALTER ... MODIFY rather than truncating an incompatible existing value.
ALTER TABLE `knowledge_spaces`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `slug` VARCHAR(160) NOT NULL;
ALTER TABLE `knowledge_space_manifests`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL;
ALTER TABLE `sources`
  MODIFY COLUMN `status` VARCHAR(16) NOT NULL;
ALTER TABLE `resource_mounts`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `mount_path` VARCHAR(384) NOT NULL,
  MODIFY COLUMN `resource_type` VARCHAR(64) NOT NULL;
ALTER TABLE `document_assets`
  MODIFY COLUMN `parser_status` VARCHAR(16) NOT NULL;
ALTER TABLE `parse_artifacts`
  MODIFY COLUMN `artifact_hash` VARCHAR(64) NOT NULL;
ALTER TABLE `artifact_segments`
  MODIFY COLUMN `checksum` VARCHAR(64) NOT NULL;
ALTER TABLE `knowledge_space_staged_commits`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `idempotency_key` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `status` VARCHAR(32) NOT NULL;
ALTER TABLE `knowledge_fs_sessions`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL;
ALTER TABLE `knowledge_fs_leases`
  MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `virtual_path` VARCHAR(384) NOT NULL,
  MODIFY COLUMN `status` VARCHAR(16) NOT NULL;
ALTER TABLE `knowledge_nodes`
  MODIFY COLUMN `kind` VARCHAR(16) NOT NULL;
ALTER TABLE `index_projections`
  MODIFY COLUMN `type` VARCHAR(32) NOT NULL,
  MODIFY COLUMN `status` VARCHAR(16) NOT NULL,
  MODIFY COLUMN `fts_document` TEXT;
ALTER TABLE `embedding_models`
  MODIFY COLUMN `provider` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `model_id` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `version` VARCHAR(128) NOT NULL,
  MODIFY COLUMN `status` VARCHAR(16) NOT NULL;
ALTER TABLE `knowledge_paths`
  MODIFY COLUMN `virtual_path` VARCHAR(384) NOT NULL,
  MODIFY COLUMN `resource_type` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `target_id` VARCHAR(512) NOT NULL,
  MODIFY COLUMN `view_type` VARCHAR(16) NOT NULL,
  MODIFY COLUMN `view_name` VARCHAR(64) NOT NULL;
ALTER TABLE `evidence_bundles`
  MODIFY COLUMN `state` VARCHAR(16) NOT NULL;
ALTER TABLE `answer_trace_steps`
  MODIFY COLUMN `name` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `status` VARCHAR(16) NOT NULL;
ALTER TABLE `graph_entities`
  MODIFY COLUMN `canonical_key` VARCHAR(512) NOT NULL,
  MODIFY COLUMN `type` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `name` VARCHAR(255) NOT NULL;
ALTER TABLE `graph_relations`
  MODIFY COLUMN `type` VARCHAR(64) NOT NULL;

-- A clean install already has model_key, and TiDB correctly prevents changing a base column with a
-- generated-column dependency. Historical schemas do not have model_key, so narrow model before
-- adding it. A partially repaired schema with model_key but the wrong model type deliberately takes
-- the ALTER branch and fails closed instead of silently accepting a mismatched generated column.
SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'index_projections'
      AND column_name = 'model'
      AND data_type = 'varchar'
      AND character_maximum_length = 255
  ),
  'DO 0',
  'ALTER TABLE `index_projections` MODIFY COLUMN `model` VARCHAR(255)'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

-- Explicit virtual columns replace disabled-by-default TiDB expression indexes. ADD repairs the
-- historical schema; MODIFY also verifies the exact type/expression when this is a clean install
-- or a retry after a partially completed repair.
ALTER TABLE `index_projections`
  ADD COLUMN IF NOT EXISTS `model_key` VARCHAR(255)
    GENERATED ALWAYS AS (COALESCE(`model`, '')) VIRTUAL,
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `index_projections`
  MODIFY COLUMN `model_key` VARCHAR(255)
    GENERATED ALWAYS AS (COALESCE(`model`, '')) VIRTUAL,
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `document_multimodal_manifests`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `document_multimodal_manifests`
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `knowledge_nodes`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `knowledge_nodes`
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `knowledge_paths`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `knowledge_paths`
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `graph_entities`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `graph_entities`
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `graph_relations`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `graph_relations`
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `document_outlines`
  ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;
ALTER TABLE `document_outlines`
  MODIFY COLUMN `publication_generation_key` CHAR(36)
    GENERATED ALWAYS AS (
      COALESCE(`publication_generation_id`, '00000000-0000-0000-0000-000000000000')
    ) VIRTUAL;

-- Replace unsupported historical JSON/FULLTEXT indexes if an experimental cluster managed to
-- create them. TiDB FTS retrieval uses the bounded posting index introduced by migration 0011.
DROP INDEX IF EXISTS `resource_mounts_permission_scope_idx` ON `resource_mounts`;
DROP INDEX IF EXISTS `knowledge_nodes_permission_scope_idx` ON `knowledge_nodes`;
DROP INDEX IF EXISTS `index_projections_fts_document_idx` ON `index_projections`;
DROP INDEX IF EXISTS `graph_entities_permission_scope_idx` ON `graph_entities`;
DROP INDEX IF EXISTS `graph_relations_permission_scope_idx` ON `graph_relations`;

-- TiDB can retain the pre-0004 projection identity index under an empty internal name when a
-- same-name DROP/CREATE replaces it in one migration artifact. That shadow key omits generation
-- and would incorrectly reject the same node/model identity in a later immutable generation.
DROP INDEX IF EXISTS `` ON `index_projections`;

-- Build an additional known-good foreign key before removing any legacy/invalidly named one. This
-- validates every existing child row first, so the forward repair cannot silently orphan data.
SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_space_fk'
  ),
  'DO 0',
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_space_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`) REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_asset_version_fk'
  ),
  'DO 0',
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_asset_version_fk` FOREIGN KEY (`knowledge_space_id`, `document_asset_id`, `document_version`) REFERENCES `document_assets` (`knowledge_space_id`, `id`, `version`) ON DELETE CASCADE'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_attempts'
      AND constraint_name = 'document_compilation_attempts_candidate_fk'
  ),
  'DO 0',
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_candidate_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `candidate_publication_id`, `candidate_fingerprint`) REFERENCES `projection_set_publications` (`tenant_id`, `knowledge_space_id`, `id`, `fingerprint`) ON DELETE RESTRICT'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'document_compilation_outbox'
      AND constraint_name = 'document_compilation_outbox_attempt_fk'
  ),
  'DO 0',
  'ALTER TABLE `document_compilation_outbox` ADD CONSTRAINT `document_compilation_outbox_attempt_fk` FOREIGN KEY (`attempt_id`) REFERENCES `document_compilation_attempts` (`id`) ON DELETE CASCADE'
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_attempt_fk_drops = (
  SELECT GROUP_CONCAT(
    CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
    ORDER BY constraint_name SEPARATOR ', '
  )
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'document_compilation_attempts'
    AND constraint_name NOT IN (
      'document_compilation_attempts_space_fk',
      'document_compilation_attempts_asset_version_fk',
      'document_compilation_attempts_candidate_fk'
    )
);
SET @kfs_baseline_repair_sql = IF(
  @kfs_baseline_repair_attempt_fk_drops IS NULL,
  'DO 0',
  CONCAT('ALTER TABLE `document_compilation_attempts` ', @kfs_baseline_repair_attempt_fk_drops)
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

SET @kfs_baseline_repair_outbox_fk_drops = (
  SELECT GROUP_CONCAT(
    CONCAT('DROP FOREIGN KEY `', REPLACE(constraint_name, '`', '``'), '`')
    ORDER BY constraint_name SEPARATOR ', '
  )
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'document_compilation_outbox'
    AND constraint_name <> 'document_compilation_outbox_attempt_fk'
);
SET @kfs_baseline_repair_sql = IF(
  @kfs_baseline_repair_outbox_fk_drops IS NULL,
  'DO 0',
  CONCAT('ALTER TABLE `document_compilation_outbox` ', @kfs_baseline_repair_outbox_fk_drops)
);
PREPARE kfs_baseline_repair_stmt FROM @kfs_baseline_repair_sql;
EXECUTE kfs_baseline_repair_stmt;
DEALLOCATE PREPARE kfs_baseline_repair_stmt;

-- Create guard indexes before replacing historical indexes with their generated-column forms.
-- If incompatible duplicates exist, guard creation fails while the old unique index is untouched.
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_knowledge_spaces_slug_guard_uq`
  ON `knowledge_spaces` (`tenant_id`, `slug`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_manifests_space_guard_uq`
  ON `knowledge_space_manifests` (`tenant_id`, `knowledge_space_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_mounts_path_guard_uq`
  ON `resource_mounts` (`knowledge_space_id`, `mount_path`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_staged_commits_guard_uq`
  ON `knowledge_space_staged_commits` (`tenant_id`, `knowledge_space_id`, `idempotency_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_multimodal_guard_uq`
  ON `document_multimodal_manifests` (
    `document_asset_id`, `version`, `publication_generation_key`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_nodes_identity_guard_uq`
  ON `knowledge_nodes` (
    `knowledge_space_id`, `parse_artifact_id`, `kind`, `start_offset`, `end_offset`,
    `publication_generation_key`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_projection_identity_guard_uq`
  ON `index_projections` (
    `node_id`, `type`, `projection_version`, `model_key`, `publication_generation_key`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_models_identity_guard_uq`
  ON `embedding_models` (`model_id`, `version`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_paths_identity_guard_uq`
  ON `knowledge_paths` (`knowledge_space_id`, `virtual_path`, `publication_generation_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_graph_entities_guard_uq`
  ON `graph_entities` (`knowledge_space_id`, `canonical_key`, `publication_generation_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_graph_relations_guard_uq`
  ON `graph_relations` (
    `knowledge_space_id`, `subject_entity_id`, `type`, `object_entity_id`,
    `extraction_version`, `publication_generation_key`
  );
CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_outlines_guard_uq`
  ON `document_outlines` (`document_asset_id`, `version`, `publication_generation_key`);

DROP INDEX IF EXISTS `knowledge_spaces_tenant_slug_uq` ON `knowledge_spaces`;
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_spaces_tenant_slug_uq`
  ON `knowledge_spaces` (`tenant_id`, `slug`);
DROP INDEX IF EXISTS `knowledge_space_manifests_tenant_space_uq`
  ON `knowledge_space_manifests`;
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_manifests_tenant_space_uq`
  ON `knowledge_space_manifests` (`tenant_id`, `knowledge_space_id`);
DROP INDEX IF EXISTS `knowledge_space_manifests_tenant_space_idx`
  ON `knowledge_space_manifests`;
CREATE INDEX IF NOT EXISTS `knowledge_space_manifests_tenant_space_idx`
  ON `knowledge_space_manifests` (`tenant_id`, `knowledge_space_id`, `id`);
DROP INDEX IF EXISTS `sources_space_status_idx` ON `sources`;
CREATE INDEX IF NOT EXISTS `sources_space_status_idx`
  ON `sources` (`knowledge_space_id`, `status`);
DROP INDEX IF EXISTS `resource_mounts_space_path_uq` ON `resource_mounts`;
CREATE UNIQUE INDEX IF NOT EXISTS `resource_mounts_space_path_uq`
  ON `resource_mounts` (`knowledge_space_id`, `mount_path`);
DROP INDEX IF EXISTS `resource_mounts_space_type_path_idx` ON `resource_mounts`;
CREATE INDEX IF NOT EXISTS `resource_mounts_space_type_path_idx`
  ON `resource_mounts` (`knowledge_space_id`, `resource_type`, `mount_path`, `id`);
DROP INDEX IF EXISTS `document_assets_space_status_created_idx` ON `document_assets`;
CREATE INDEX IF NOT EXISTS `document_assets_space_status_created_idx`
  ON `document_assets` (`knowledge_space_id`, `parser_status`, `created_at`, `id`);
DROP INDEX IF EXISTS `parse_artifacts_hash_idx` ON `parse_artifacts`;
CREATE INDEX IF NOT EXISTS `parse_artifacts_hash_idx`
  ON `parse_artifacts` (`artifact_hash`);
DROP INDEX IF EXISTS `artifact_segments_space_checksum_idx` ON `artifact_segments`;
CREATE INDEX IF NOT EXISTS `artifact_segments_space_checksum_idx`
  ON `artifact_segments` (`knowledge_space_id`, `checksum`, `id`);
DROP INDEX IF EXISTS `knowledge_space_staged_commits_idempotency_uq`
  ON `knowledge_space_staged_commits`;
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_staged_commits_idempotency_uq`
  ON `knowledge_space_staged_commits` (`tenant_id`, `knowledge_space_id`, `idempotency_key`);
DROP INDEX IF EXISTS `knowledge_space_staged_commits_status_updated_idx`
  ON `knowledge_space_staged_commits`;
CREATE INDEX IF NOT EXISTS `knowledge_space_staged_commits_status_updated_idx`
  ON `knowledge_space_staged_commits` (
    `tenant_id`, `knowledge_space_id`, `status`, `updated_at`, `id`
  );
DROP INDEX IF EXISTS `knowledge_space_staged_commits_expiry_idx`
  ON `knowledge_space_staged_commits`;
CREATE INDEX IF NOT EXISTS `knowledge_space_staged_commits_expiry_idx`
  ON `knowledge_space_staged_commits` (
    `tenant_id`, `knowledge_space_id`, `expires_at`, `id`
  );
DROP INDEX IF EXISTS `knowledge_fs_sessions_space_expiry_idx` ON `knowledge_fs_sessions`;
CREATE INDEX IF NOT EXISTS `knowledge_fs_sessions_space_expiry_idx`
  ON `knowledge_fs_sessions` (`tenant_id`, `knowledge_space_id`, `expires_at`, `id`);
DROP INDEX IF EXISTS `knowledge_fs_sessions_expiry_idx` ON `knowledge_fs_sessions`;
CREATE INDEX IF NOT EXISTS `knowledge_fs_sessions_expiry_idx`
  ON `knowledge_fs_sessions` (`tenant_id`, `expires_at`, `id`);
DROP INDEX IF EXISTS `knowledge_fs_leases_active_path_idx` ON `knowledge_fs_leases`;
CREATE INDEX IF NOT EXISTS `knowledge_fs_leases_active_path_idx`
  ON `knowledge_fs_leases` (
    `tenant_id`, `knowledge_space_id`, `status`, `virtual_path`, `expires_at`, `id`
  );
DROP INDEX IF EXISTS `knowledge_fs_leases_expiry_idx` ON `knowledge_fs_leases`;
CREATE INDEX IF NOT EXISTS `knowledge_fs_leases_expiry_idx`
  ON `knowledge_fs_leases` (`tenant_id`, `expires_at`, `id`);
DROP INDEX IF EXISTS `knowledge_fs_leases_session_idx` ON `knowledge_fs_leases`;
CREATE INDEX IF NOT EXISTS `knowledge_fs_leases_session_idx`
  ON `knowledge_fs_leases` (`tenant_id`, `session_id`, `status`, `id`);

DROP INDEX IF EXISTS `document_multimodal_manifests_asset_version_uq`
  ON `document_multimodal_manifests`;
CREATE UNIQUE INDEX IF NOT EXISTS `document_multimodal_manifests_asset_version_uq`
  ON `document_multimodal_manifests` (
    `document_asset_id`, `version`, `publication_generation_key`
  );
DROP INDEX IF EXISTS `knowledge_nodes_space_asset_kind_idx` ON `knowledge_nodes`;
CREATE INDEX IF NOT EXISTS `knowledge_nodes_space_asset_kind_idx`
  ON `knowledge_nodes` (
    `knowledge_space_id`, `publication_generation_id`, `document_asset_id`, `kind`, `id`
  );
DROP INDEX IF EXISTS `knowledge_nodes_artifact_offset_idx` ON `knowledge_nodes`;
CREATE INDEX IF NOT EXISTS `knowledge_nodes_artifact_offset_idx`
  ON `knowledge_nodes` (
    `knowledge_space_id`, `parse_artifact_id`, `publication_generation_id`, `start_offset`, `id`
  );
DROP INDEX IF EXISTS `knowledge_nodes_artifact_kind_offsets_uq` ON `knowledge_nodes`;
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_nodes_artifact_kind_offsets_uq`
  ON `knowledge_nodes` (
    `knowledge_space_id`, `parse_artifact_id`, `kind`, `start_offset`, `end_offset`,
    `publication_generation_key`
  );
DROP INDEX IF EXISTS `index_projections_space_type_status_idx` ON `index_projections`;
CREATE INDEX IF NOT EXISTS `index_projections_space_type_status_idx`
  ON `index_projections` (
    `knowledge_space_id`, `publication_generation_id`, `type`, `status`, `node_id`, `id`
  );
DROP INDEX IF EXISTS `index_projections_node_type_version_idx` ON `index_projections`;
CREATE INDEX IF NOT EXISTS `index_projections_node_type_version_idx`
  ON `index_projections` (`node_id`, `type`, `projection_version`);
DROP INDEX IF EXISTS `index_projections_fts_backfill_idx` ON `index_projections`;
CREATE INDEX IF NOT EXISTS `index_projections_fts_backfill_idx`
  ON `index_projections` (`knowledge_space_id`, `type`, `id`);
DROP INDEX IF EXISTS `index_projections_node_type_version_model_uq` ON `index_projections`;
CREATE UNIQUE INDEX IF NOT EXISTS `index_projections_node_type_version_model_uq`
  ON `index_projections` (
    `node_id`, `type`, `projection_version`, `model_key`, `publication_generation_key`
  );
DROP INDEX IF EXISTS `embedding_models_model_version_uq` ON `embedding_models`;
CREATE UNIQUE INDEX IF NOT EXISTS `embedding_models_model_version_uq`
  ON `embedding_models` (`model_id`, `version`);
DROP INDEX IF EXISTS `embedding_models_status_provider_idx` ON `embedding_models`;
CREATE INDEX IF NOT EXISTS `embedding_models_status_provider_idx`
  ON `embedding_models` (`status`, `provider`, `model_id`, `id`);
DROP INDEX IF EXISTS `embedding_models_status_model_idx` ON `embedding_models`;
CREATE INDEX IF NOT EXISTS `embedding_models_status_model_idx`
  ON `embedding_models` (`status`, `model_id`, `id`);
DROP INDEX IF EXISTS `knowledge_paths_space_path_uq` ON `knowledge_paths`;
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_paths_space_path_uq`
  ON `knowledge_paths` (`knowledge_space_id`, `virtual_path`, `publication_generation_key`);
DROP INDEX IF EXISTS `knowledge_paths_target_idx` ON `knowledge_paths`;
CREATE INDEX IF NOT EXISTS `knowledge_paths_target_idx`
  ON `knowledge_paths` (`resource_type`, `target_id`);
DROP INDEX IF EXISTS `knowledge_paths_space_view_path_idx` ON `knowledge_paths`;
CREATE INDEX IF NOT EXISTS `knowledge_paths_space_view_path_idx`
  ON `knowledge_paths` (
    `knowledge_space_id`, `publication_generation_id`, `view_type`, `view_name`, `virtual_path`, `id`
  );
DROP INDEX IF EXISTS `evidence_bundles_state_created_idx` ON `evidence_bundles`;
CREATE INDEX IF NOT EXISTS `evidence_bundles_state_created_idx`
  ON `evidence_bundles` (`state`, `created_at`, `id`);
DROP INDEX IF EXISTS `graph_entities_space_key_uq` ON `graph_entities`;
CREATE UNIQUE INDEX IF NOT EXISTS `graph_entities_space_key_uq`
  ON `graph_entities` (`knowledge_space_id`, `canonical_key`, `publication_generation_key`);
DROP INDEX IF EXISTS `graph_entities_space_type_name_idx` ON `graph_entities`;
CREATE INDEX IF NOT EXISTS `graph_entities_space_type_name_idx`
  ON `graph_entities` (
    `knowledge_space_id`, `publication_generation_id`, `type`, `name`, `id`
  );
DROP INDEX IF EXISTS `graph_relations_subject_traversal_idx` ON `graph_relations`;
CREATE INDEX IF NOT EXISTS `graph_relations_subject_traversal_idx`
  ON `graph_relations` (
    `knowledge_space_id`, `publication_generation_id`, `subject_entity_id`, `type`,
    `object_entity_id`, `id`
  );
DROP INDEX IF EXISTS `graph_relations_object_traversal_idx` ON `graph_relations`;
CREATE INDEX IF NOT EXISTS `graph_relations_object_traversal_idx`
  ON `graph_relations` (
    `knowledge_space_id`, `publication_generation_id`, `object_entity_id`, `type`,
    `subject_entity_id`, `id`
  );
DROP INDEX IF EXISTS `graph_relations_space_edge_version_uq` ON `graph_relations`;
CREATE UNIQUE INDEX IF NOT EXISTS `graph_relations_space_edge_version_uq`
  ON `graph_relations` (
    `knowledge_space_id`, `subject_entity_id`, `type`, `object_entity_id`,
    `extraction_version`, `publication_generation_key`
  );
DROP INDEX IF EXISTS `document_outlines_asset_version_uq` ON `document_outlines`;
CREATE UNIQUE INDEX IF NOT EXISTS `document_outlines_asset_version_uq`
  ON `document_outlines` (`document_asset_id`, `version`, `publication_generation_key`);

DROP INDEX IF EXISTS `kfs_repair_knowledge_spaces_slug_guard_uq` ON `knowledge_spaces`;
DROP INDEX IF EXISTS `kfs_repair_manifests_space_guard_uq` ON `knowledge_space_manifests`;
DROP INDEX IF EXISTS `kfs_repair_mounts_path_guard_uq` ON `resource_mounts`;
DROP INDEX IF EXISTS `kfs_repair_staged_commits_guard_uq` ON `knowledge_space_staged_commits`;
DROP INDEX IF EXISTS `kfs_repair_multimodal_guard_uq` ON `document_multimodal_manifests`;
DROP INDEX IF EXISTS `kfs_repair_nodes_identity_guard_uq` ON `knowledge_nodes`;
DROP INDEX IF EXISTS `kfs_repair_projection_identity_guard_uq` ON `index_projections`;
DROP INDEX IF EXISTS `kfs_repair_models_identity_guard_uq` ON `embedding_models`;
DROP INDEX IF EXISTS `kfs_repair_paths_identity_guard_uq` ON `knowledge_paths`;
DROP INDEX IF EXISTS `kfs_repair_graph_entities_guard_uq` ON `graph_entities`;
DROP INDEX IF EXISTS `kfs_repair_graph_relations_guard_uq` ON `graph_relations`;
DROP INDEX IF EXISTS `kfs_repair_outlines_guard_uq` ON `document_outlines`;
