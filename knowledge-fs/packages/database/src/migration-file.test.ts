import { describe, expect, it } from "vitest";

import {
  findMigrationArtifactDrift,
  getDatabaseMigrationArtifacts,
  getInitialSchemaMigrationArtifacts,
  getPendingMigrationArtifacts,
  renderMigrationFile,
  renderSchemaMigrationsTableSql,
} from "./migration-file";

describe("migration file rendering", () => {
  it("renders deterministic PostgreSQL migration text with tables before indexes", () => {
    const migration = renderMigrationFile({
      dialect: "postgres",
      migrationId: "0001_initial_schema",
    });

    expect(migration).toMatch(/^-- Knowledge Platform schema migration\n/);
    expect(migration).toContain("-- Migration id: 0001_initial_schema\n");
    expect(migration).toContain("-- Dialect: postgres\n");
    expect(migration.indexOf('CREATE TABLE IF NOT EXISTS "knowledge_spaces"')).toBeLessThan(
      migration.indexOf('CREATE INDEX IF NOT EXISTS "sources_space_status_idx"'),
    );
    expect(migration).toContain('USING GIN ("permission_scope")');
    expect(migration.trimEnd().endsWith(";")).toBe(true);
  });

  it("renders deterministic TiDB migration text with TiDB quoting", () => {
    const migration = renderMigrationFile({
      dialect: "tidb",
      migrationId: "0001_initial_schema",
    });

    expect(migration).toContain("-- Migration id: 0001_initial_schema\n");
    expect(migration).toContain("-- Dialect: tidb\n");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `knowledge_spaces`");
    expect(migration).not.toContain("knowledge_nodes_permission_scope_idx");
    expect(migration).not.toContain("FULLTEXT INDEX");
    expect(migration).not.toContain("CAST(COALESCE");
    expect(migration).not.toContain("USING GIN");
  });

  it("returns sorted checked-in initial schema migration artifacts", () => {
    const artifacts = getInitialSchemaMigrationArtifacts();

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "packages/database/migrations/0001_initial_schema.postgres.sql",
      "packages/database/migrations/0001_initial_schema.tidb.sql",
    ]);
    expect(artifacts[0]?.content).toContain("-- Dialect: postgres\n");
    expect(artifacts[0]?.content).toContain('USING GIN ("permission_scope")');
    expect(artifacts[0]?.content).toContain('"dense_vector" vector(1536)');
    expect(artifacts[0]?.content).toContain("vector_cosine_ops");
    expect(artifacts[1]?.content).toContain("-- Dialect: tidb\n");
    expect(artifacts[1]?.content).not.toContain("USING GIN");
  });

  it("keeps incremental migrations separate from the immutable initial schema", () => {
    const artifacts = getDatabaseMigrationArtifacts();

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "packages/database/migrations/0001_initial_schema.postgres.sql",
      "packages/database/migrations/0001_initial_schema.tidb.sql",
      "packages/database/migrations/0002_vector_index_upgrade.postgres.sql",
      "packages/database/migrations/0002_vector_index_upgrade.tidb.sql",
      "packages/database/migrations/0003_projection_set_publications.postgres.sql",
      "packages/database/migrations/0003_projection_set_publications.tidb.sql",
      "packages/database/migrations/0004_projection_publication_members.postgres.sql",
      "packages/database/migrations/0004_projection_publication_members.tidb.sql",
      "packages/database/migrations/0005_publication_generation_nonzero.postgres.sql",
      "packages/database/migrations/0005_publication_generation_nonzero.tidb.sql",
      "packages/database/migrations/0006_document_compilation_attempts.postgres.sql",
      "packages/database/migrations/0006_document_compilation_attempts.tidb.sql",
      "packages/database/migrations/0007_knowledge_node_generations.postgres.sql",
      "packages/database/migrations/0007_knowledge_node_generations.tidb.sql",
      "packages/database/migrations/0008_flattened_page_index.postgres.sql",
      "packages/database/migrations/0008_flattened_page_index.tidb.sql",
      "packages/database/migrations/0009_legacy_space_bootstrap.postgres.sql",
      "packages/database/migrations/0009_legacy_space_bootstrap.tidb.sql",
      "packages/database/migrations/0010_page_index_upgrade_backfill.postgres.sql",
      "packages/database/migrations/0010_page_index_upgrade_backfill.tidb.sql",
      "packages/database/migrations/0011_tidb_fts_postings.postgres.sql",
      "packages/database/migrations/0011_tidb_fts_postings.tidb.sql",
      "packages/database/migrations/0012_tidb_baseline_repair.postgres.sql",
      "packages/database/migrations/0012_tidb_baseline_repair.tidb.sql",
      "packages/database/migrations/0013_space_access_control.postgres.sql",
      "packages/database/migrations/0013_space_access_control.tidb.sql",
      "packages/database/migrations/0014_source_credential_refs.postgres.sql",
      "packages/database/migrations/0014_source_credential_refs.tidb.sql",
      "packages/database/migrations/0015_research_task_jobs.postgres.sql",
      "packages/database/migrations/0015_research_task_jobs.tidb.sql",
      "packages/database/migrations/0016_compilation_job_requester_binding.postgres.sql",
      "packages/database/migrations/0016_compilation_job_requester_binding.tidb.sql",
      "packages/database/migrations/0017_durable_deletion.postgres.sql",
      "packages/database/migrations/0017_durable_deletion.tidb.sql",
      "packages/database/migrations/0018_versioned_space_profiles.postgres.sql",
      "packages/database/migrations/0018_versioned_space_profiles.tidb.sql",
      "packages/database/migrations/0019_profile_publication_bindings.postgres.sql",
      "packages/database/migrations/0019_profile_publication_bindings.tidb.sql",
      "packages/database/migrations/0020_profile_migration_runs.postgres.sql",
      "packages/database/migrations/0020_profile_migration_runs.tidb.sql",
      "packages/database/migrations/0021_source_product_workflows.postgres.sql",
      "packages/database/migrations/0021_source_product_workflows.tidb.sql",
      "packages/database/migrations/0022_logical_document_revisions.postgres.sql",
      "packages/database/migrations/0022_logical_document_revisions.tidb.sql",
      "packages/database/migrations/0023_knowledge_space_overview.postgres.sql",
      "packages/database/migrations/0023_knowledge_space_overview.tidb.sql",
      "packages/database/migrations/0024_quality_control.postgres.sql",
      "packages/database/migrations/0024_quality_control.tidb.sql",
      "packages/database/migrations/0025_capability_grant_provenance.postgres.sql",
      "packages/database/migrations/0025_capability_grant_provenance.tidb.sql",
      "packages/database/migrations/0026_capability_job_provenance.postgres.sql",
      "packages/database/migrations/0026_capability_job_provenance.tidb.sql",
      "packages/database/migrations/0027_upload_sessions.postgres.sql",
      "packages/database/migrations/0027_upload_sessions.tidb.sql",
      "packages/database/migrations/0028_dify_integration_states.postgres.sql",
      "packages/database/migrations/0028_dify_integration_states.tidb.sql",
      "packages/database/migrations/0029_dify_integration_freezes.postgres.sql",
      "packages/database/migrations/0029_dify_integration_freezes.tidb.sql",
    ]);
    expect(artifacts[2]?.content).toContain('ALTER COLUMN "dense_vector" TYPE vector');
    expect(artifacts[2]?.content).not.toContain("vector(1536)");
    expect(artifacts[2]?.content).not.toContain("vector_cosine_ops");
    expect(artifacts[2]?.content).toContain(
      'DROP INDEX IF EXISTS "index_projections_dense_vector_hnsw_idx"',
    );
    expect(artifacts[2]?.content).toContain(
      'DROP INDEX IF EXISTS "index_projections_visual_vector_hnsw_idx"',
    );
    expect(artifacts[2]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "index_projections_node_type_version_model_uq"',
    );
    expect(artifacts[16]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_mutation_leases"',
    );
    expect(artifacts[16]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "legacy_space_publication_bootstraps"',
    );
    expect(artifacts[17]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `knowledge_space_mutation_leases`",
    );
    expect(artifacts[18]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "page_index_upgrade_backfills"',
    );
    expect(artifacts[19]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `page_index_upgrade_backfills`",
    );
    expect(artifacts[20]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "index_projection_fts_postings"',
    );
    expect(artifacts[20]?.content).toContain("projection_set_publications_status_ck");
    expect(artifacts[20]?.content).toContain('"index_projections_space_id_uq"');
    expect(artifacts[20]?.content).toContain('FOREIGN KEY ("knowledge_space_id", "projection_id")');
    expect(artifacts[20]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "tidb_fts_posting_backfills"',
    );
    expect(artifacts[21]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `index_projection_fts_postings`",
    );
    expect(artifacts[21]?.content).toContain("`index_projection_fts_postings_lookup_idx`");
    expect(artifacts[21]?.content).toContain("`index_projections_space_id_uq`");
    expect(artifacts[21]?.content).toContain("ON `index_projections` (`knowledge_space_id`, `id`)");
    expect(artifacts[21]?.content).toContain("FOREIGN KEY (`knowledge_space_id`, `projection_id`)");
    expect(artifacts[21]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `tidb_fts_posting_backfills`",
    );
    expect(artifacts[21]?.content).not.toContain("WITH RECURSIVE token_remainders");
    expect(artifacts[21]?.content).not.toContain("INSTR(LOWER(");
    expect(artifacts[22]?.content).toContain("SELECT 1 WHERE FALSE");
    expect(artifacts[23]?.content).toContain("-- Migration id: 0012_tidb_baseline_repair");
    expect(artifacts[23]?.content).toContain("MODIFY COLUMN `tenant_id` VARCHAR(255) NOT NULL");
    expect(artifacts[23]?.content).toContain(
      "ADD COLUMN IF NOT EXISTS `publication_generation_key` CHAR(36)",
    );
    expect(artifacts[23]?.content).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS `kfs_repair_projection_identity_guard_uq`",
    );
    expect(artifacts[23]?.content).toContain(
      "ADD CONSTRAINT `document_compilation_attempts_candidate_fk`",
    );
    expect(artifacts[23]?.content).toContain("DROP INDEX IF EXISTS `` ON `index_projections`");
    expect(artifacts[23]?.content).toContain(
      "ON `index_projections` (`knowledge_space_id`, `type`, `id`)",
    );
    expect(artifacts[23]?.content).toContain("information_schema.tidb_check_constraints");
    expect(artifacts[23]?.content).not.toMatch(/\bDELETE\b\s+(?:FROM|\w+\s+FROM)/iu);
    expect(artifacts[23]?.content).not.toContain("FULLTEXT INDEX");
    expect(artifacts[24]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_permission_snapshots"',
    );
    expect(artifacts[25]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `knowledge_space_permission_snapshots`",
    );
    expect(artifacts[26]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "source_secret_lifecycle_refs"',
    );
    expect(artifacts[26]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "source_secret_lifecycle_refs_ref_uq"',
    );
    expect(artifacts[26]?.content).toContain('INSERT INTO "source_secret_lifecycle_refs"');
    expect(artifacts[26]?.content).toContain("DO $kfs_source_secret_lifecycle_guard$");
    expect(artifacts[26]?.content).toContain("RAISE EXCEPTION");
    expect(artifacts[26]?.content).toContain(
      'src."credential_ref" IS DISTINCT FROM lifecycle."credential_ref"',
    );
    expect(artifacts[27]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `source_secret_lifecycle_refs`",
    );
    expect(artifacts[27]?.content).toContain("INSERT IGNORE INTO `source_secret_lifecycle_refs`");
    expect(artifacts[27]?.content).toContain(
      "CREATE TEMPORARY TABLE `kfs_source_secret_lifecycle_registry_guard`",
    );
    expect(artifacts[27]?.content).toContain(
      "INSERT INTO `kfs_source_secret_lifecycle_registry_guard` (`valid`)\nSELECT NULL\nWHERE EXISTS",
    );
    expect(artifacts[27]?.content).not.toContain("CREATE PROCEDURE");
    expect(artifacts[27]?.content).toContain(
      "NOT (src.`credential_ref` <=> lifecycle.`credential_ref`)",
    );
    expect(artifacts[28]?.content).toContain('CREATE TABLE IF NOT EXISTS "research_task_outbox"');
    expect(artifacts[29]?.content).toContain("CREATE TABLE IF NOT EXISTS `research_task_outbox`");
    expect(artifacts[28]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "research_task_progress_events"',
    );
    expect(artifacts[29]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `research_task_progress_events`",
    );
    expect(artifacts[32]?.content).toContain('CREATE TABLE IF NOT EXISTS "deletion_jobs"');
    expect(artifacts[32]?.content).toContain('ON "deletion_jobs" ("tenant_id", "idempotency_key")');
    expect(artifacts[33]?.content).toContain("CREATE TABLE `deletion_jobs`");
    expect(artifacts[33]?.content).toContain("ON `deletion_jobs` (`tenant_id`, `idempotency_key`)");
    expect(artifacts[34]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_profile_revisions"',
    );
    expect(artifacts[34]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_profile_backfills"',
    );
    expect(artifacts[34]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_backfills_source_uq"',
    );
    expect(artifacts[34]?.content).not.toContain("1536");
    expect(artifacts[35]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `knowledge_space_profile_heads`",
    );
    expect(artifacts[35]?.content).toContain("`dimension` INT");
    expect(artifacts[35]?.content).toContain("`lease_token` CHAR(36)");
    expect(artifacts[35]?.content).not.toContain("1536");
    expect(artifacts[36]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_profile_publication_bindings"',
    );
    expect(artifacts[37]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `knowledge_space_profile_publication_bindings`",
    );
    expect(artifacts[38]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_profile_migration_runs"',
    );
    expect(artifacts[38]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_migration_runs_active_uq"',
    );
    expect(artifacts[38]?.content).toContain('"base_publication_fingerprint" VARCHAR(86)');
    expect(artifacts[39]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `knowledge_space_profile_migration_outbox`",
    );
    expect(artifacts[39]?.content).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_profile_migration_runs_active_uq`",
    );
    expect(artifacts[3]?.content).toContain("MODIFY COLUMN IF EXISTS `dense_vector` VECTOR");
    expect(artifacts[3]?.content).not.toContain("VECTOR(1536)");
    expect(artifacts[3]?.content).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS `index_projections_node_type_version_model_uq`",
    );
    expect(artifacts[4]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "projection_set_publications"',
    );
    expect(artifacts[4]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publication_heads_space_uq"',
    );
    expect(artifacts[4]?.content).toContain('"head_revision" INTEGER NOT NULL');
    expect(artifacts[4]?.content).toContain('"tenant_id" VARCHAR(255) NOT NULL');
    expect(artifacts[4]?.content).toContain('"fingerprint" VARCHAR(86) NOT NULL');
    expect(artifacts[4]?.content).toContain('"status" VARCHAR(16) NOT NULL');
    expect(artifacts[5]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `projection_set_publications`",
    );
    expect(artifacts[5]?.content).toContain("`tenant_id` VARCHAR(255) NOT NULL");
    expect(artifacts[5]?.content).toContain("`fingerprint` VARCHAR(86) NOT NULL");
    expect(artifacts[5]?.content).toContain("`status` VARCHAR(16) NOT NULL");
    expect(artifacts[5]?.content).not.toContain("`tenant_id` TEXT");
    expect(artifacts[5]?.content).toContain(
      "FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `publication_id`)",
    );
    expect(artifacts[5]?.content).toContain(
      "REFERENCES `projection_set_publications` (`tenant_id`, `knowledge_space_id`, `id`)",
    );
    expect(artifacts[5]?.content).toContain("ON DELETE RESTRICT");
    expect(artifacts[6]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "projection_set_publication_members"',
    );
    expect(artifacts[6]?.content).toContain(
      'ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID',
    );
    expect(artifacts[6]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "graph_relations_space_edge_version_uq"',
    );
    expect(artifacts[6]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "document_outlines_asset_version_uq"',
    );
    expect(artifacts[6]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "projection_set_publication_members_generation_idx"',
    );
    expect(artifacts[6]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "projection_set_publication_members_document_idx"',
    );
    expect(artifacts[6]?.content).toContain(
      `COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid)`,
    );
    expect(artifacts[6]?.content).not.toContain("vector(1536)");
    expect(artifacts[6]?.content).not.toContain('DELETE FROM "graph_relations"');
    expect(artifacts[6]?.content).not.toContain('DELETE FROM "document_outlines"');
    expect(artifacts[7]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `projection_set_publication_members`",
    );
    expect(artifacts[7]?.content).toContain(
      "ADD COLUMN IF NOT EXISTS `publication_generation_id` CHAR(36)",
    );
    expect(artifacts[7]?.content).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS `graph_relations_space_edge_version_uq`",
    );
    expect(artifacts[7]?.content).toContain("`publication_generation_key`");
    expect(artifacts[7]?.content).not.toContain("CAST(COALESCE");
    expect(artifacts[7]?.content).not.toContain("VECTOR(1536)");
    expect(artifacts[7]?.content).not.toContain("DELETE duplicate FROM `graph_relations`");
    expect(artifacts[7]?.content).not.toContain("DELETE duplicate FROM `document_outlines`");

    const generationScopedIndexes = {
      graph_entities_space_type_name_idx: [
        "knowledge_space_id",
        "publication_generation_id",
        "type",
        "name",
        "id",
      ],
      graph_relations_object_traversal_idx: [
        "knowledge_space_id",
        "publication_generation_id",
        "object_entity_id",
        "type",
        "subject_entity_id",
        "id",
      ],
      graph_relations_subject_traversal_idx: [
        "knowledge_space_id",
        "publication_generation_id",
        "subject_entity_id",
        "type",
        "object_entity_id",
        "id",
      ],
      index_projections_space_type_status_idx: [
        "knowledge_space_id",
        "publication_generation_id",
        "type",
        "status",
        "node_id",
        "id",
      ],
      knowledge_paths_space_view_path_idx: [
        "knowledge_space_id",
        "publication_generation_id",
        "view_type",
        "view_name",
        "virtual_path",
        "id",
      ],
    } as const;
    for (const [indexName, columns] of Object.entries(generationScopedIndexes)) {
      expectMigrationIndexColumns(artifacts[6]?.content, "postgres", indexName, columns);
      expectMigrationIndexColumns(artifacts[7]?.content, "tidb", indexName, columns);
    }

    const nonzeroConstraintNames = [
      "index_projections_pub_gen_nonzero_ck",
      "document_outlines_pub_gen_nonzero_ck",
      "document_multimodal_pub_gen_nonzero_ck",
      "knowledge_paths_pub_gen_nonzero_ck",
      "graph_entities_pub_gen_nonzero_ck",
      "graph_relations_pub_gen_nonzero_ck",
      "publication_members_gen_nonzero_ck",
    ];
    for (const constraintName of nonzeroConstraintNames) {
      expect(artifacts[8]?.content).toContain(`ADD CONSTRAINT "${constraintName}"`);
      expect(artifacts[9]?.content).toContain(`ADD CONSTRAINT \`${constraintName}\``);
    }
    expect(artifacts[14]?.content).toContain('CREATE TABLE IF NOT EXISTS "page_index_manifests"');
    expect(artifacts[14]?.content).toContain(
      'ON "page_index_terms" ("knowledge_space_id", "term", "page_index_node_id"',
    );
    expect(artifacts[14]?.content).toContain(
      'ON "page_index_terms" ("knowledge_space_id", "manifest_id", "term"',
    );
    expect(artifacts[15]?.content).toContain("CREATE TABLE IF NOT EXISTS `page_index_manifests`");
    expect(artifacts[15]?.content).toContain(
      "ON `page_index_terms` (`knowledge_space_id`, `term`, `page_index_node_id`",
    );
    expect(artifacts[15]?.content).toContain(
      "ON `page_index_terms` (`knowledge_space_id`, `manifest_id`, `term`",
    );
    expect(artifacts[8]?.content).toContain(
      '"publication_generation_id" IS NULL\n    OR "publication_generation_id" <> \'00000000-0000-0000-0000-000000000000\'::uuid',
    );
    expect(artifacts[8]?.content).toContain(
      "CHECK (\"generation_id\" <> '00000000-0000-0000-0000-000000000000'::uuid)",
    );
    expect(artifacts[9]?.content).toContain(
      "`publication_generation_id` IS NULL\n    OR (`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-",
    );
    expect(artifacts[9]?.content).toContain("CHECK (`generation_id` REGEXP '^[0-9A-Fa-f]{8}-");
    expect(artifacts[9]?.content).toContain(
      "AND `generation_id` <> '00000000-0000-0000-0000-000000000000'",
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "document_compilation_attempts"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE TABLE IF NOT EXISTS "document_compilation_outbox"',
    );
    expect(artifacts[10]?.content).toContain('"publication_generation_id" UUID NOT NULL');
    expect(artifacts[10]?.content).toContain(
      "CHECK (\"publication_generation_id\" <> '00000000-0000-0000-0000-000000000000'::uuid)",
    );
    expect(artifacts[10]?.content).toContain('CHECK ("active_slot" IS NULL OR "active_slot" = 1)');
    expect(artifacts[10]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "document_compilation_attempts_scope_version_active_uq"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_attempts_run_schedule_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_attempts_lease_recovery_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_attempts_document_version_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_attempts_candidate_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_attempts_tenant_completed_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "document_compilation_outbox_attempt_event_uq"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "document_compilation_outbox_idempotency_uq"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_outbox_delivery_due_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE INDEX IF NOT EXISTS "document_compilation_outbox_lock_recovery_idx"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_spaces_tenant_id_uq"',
    );
    expect(artifacts[10]?.content).toContain(
      'ADD CONSTRAINT "knowledge_spaces_tenant_id_length_ck"',
    );
    expect(artifacts[10]?.content).toContain('CHECK (CHAR_LENGTH("tenant_id") <= 255)');
    expect(artifacts[10]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "document_assets_space_id_version_uq"',
    );
    expect(artifacts[10]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publications_space_id_fingerprint_uq"',
    );
    expect(artifacts[10]?.content).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id")\n    REFERENCES "knowledge_spaces" ("tenant_id", "id")\n    ON DELETE CASCADE',
    );
    expect(artifacts[10]?.content).toContain(
      'FOREIGN KEY ("knowledge_space_id", "document_asset_id", "document_version")\n    REFERENCES "document_assets" ("knowledge_space_id", "id", "version")\n    ON DELETE CASCADE',
    );
    expect(artifacts[10]?.content).toContain('"candidate_fingerprint"\n  )');
    expect(artifacts[10]?.content).toContain('"id",\n      "fingerprint"\n    )');
    expect(artifacts[10]?.content).toContain(
      'FOREIGN KEY ("attempt_id")\n    REFERENCES "document_compilation_attempts" ("id")\n    ON DELETE CASCADE',
    );
    expect(artifacts[10]?.content).toContain('"queue_job_id" VARCHAR(255)');
    expect(artifacts[10]?.content).toContain('"external_job_id" VARCHAR(255)');
    expect(artifacts[10]?.content).toContain('"lease_token" UUID');
    expect(artifacts[10]?.content).toContain('"lock_token" UUID');
    expect(artifacts[10]?.content).toContain('"last_error_code" VARCHAR(64)');
    expect(artifacts[10]?.content).not.toContain('"last_error_code" VARCHAR(128)');
    for (const constraintName of [
      "document_compilation_attempts_base_revision_ck",
      "document_compilation_attempts_execution_count_ck",
      "document_compilation_attempts_row_version_ck",
      "document_compilation_attempts_checkpoint_ck",
      "document_compilation_attempts_run_state_ck",
      "document_compilation_attempts_lifecycle_ck",
      "document_compilation_attempts_retry_schedule_ck",
      "document_compilation_attempts_lease_state_ck",
      "document_compilation_attempts_lease_token_ck",
      "document_compilation_outbox_event_type_ck",
      "document_compilation_outbox_schema_version_ck",
      "document_compilation_outbox_status_ck",
      "document_compilation_outbox_dispatch_attempts_ck",
      "document_compilation_outbox_lock_state_ck",
      "document_compilation_outbox_lock_token_ck",
    ]) {
      expect(artifacts[10]?.content).toContain(`CONSTRAINT "${constraintName}"`);
      expect(artifacts[11]?.content).toContain(`CONSTRAINT \`${constraintName}\``);
    }
    for (const constraintName of [
      "document_compilation_attempts_document_version_ck",
      "document_compilation_attempts_candidate_pair_ck",
    ]) {
      expect(artifacts[10]?.content).toContain(`CONSTRAINT "${constraintName}"`);
      expect(artifacts[11]?.content).not.toContain(`CONSTRAINT \`${constraintName}\``);
    }
    expect(artifacts[10]?.content).toContain('CHECK ("document_version" > 0)');
    expect(artifacts[10]?.content).toContain('CHECK ("base_head_revision" >= 0)');
    expect(artifacts[10]?.content).toContain('"execution_attempts" <= "max_execution_attempts"');
    expect(artifacts[10]?.content).toContain('CHECK ("row_version" >= 0)');
    expect(artifacts[10]?.content).toContain("'dispatch_pending'");
    expect(artifacts[10]?.content).not.toContain("'pending_dispatch'");
    expect(artifacts[10]?.content).toContain("'superseded'");
    expect(artifacts[10]?.content).toContain("'dispatched'");
    expect(artifacts[10]?.content).toContain('CHECK ("schema_version" = 1)');
    expect(artifacts[10]?.content).toContain('CHECK ("dispatch_attempts" >= 0)');
    expect(artifacts[10]?.content).toContain('"active_slot" IS NULL');
    expect(artifacts[10]?.content).toContain('"active_slot" = 1');
    expect(artifacts[10]?.content).toContain('"candidate_publication_id" IS NULL');
    expect(artifacts[10]?.content).toContain('"candidate_fingerprint" IS NOT NULL');
    expect(artifacts[10]?.content).toContain('"worker_id" IS NOT NULL');
    expect(artifacts[10]?.content).toContain('"lease_expires_at" IS NULL');
    expect(artifacts[10]?.content).toContain('"locked_by" IS NOT NULL');
    expect(artifacts[10]?.content).toContain('"locked_until" IS NULL');
    expect(artifacts[11]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `document_compilation_attempts`",
    );
    expect(artifacts[11]?.content).toContain(
      "CREATE TABLE IF NOT EXISTS `document_compilation_outbox`",
    );
    expect(artifacts[11]?.content).toContain(
      "`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-",
    );
    expect(artifacts[11]?.content).toContain(
      "AND `publication_generation_id` <> '00000000-0000-0000-0000-000000000000'",
    );
    expect(artifacts[11]?.content).toContain("CHECK (`active_slot` IS NULL OR `active_slot` = 1)");
    expect(artifacts[11]?.content).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS `document_compilation_attempts_scope_version_active_uq`",
    );
    expect(artifacts[11]?.content).toContain(
      "CREATE INDEX IF NOT EXISTS `document_compilation_outbox_delivery_due_idx`",
    );
    expect(artifacts[11]?.content).toContain(
      "ADD CONSTRAINT `knowledge_spaces_tenant_id_length_ck`",
    );
    expect(artifacts[11]?.content).toContain(
      "CREATE INDEX IF NOT EXISTS `document_compilation_outbox_lock_recovery_idx`",
    );
    expect(artifacts[12]?.content).toContain(
      'ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID',
    );
    expect(artifacts[12]?.content).toContain('ADD CONSTRAINT "knowledge_nodes_pub_gen_nonzero_ck"');
    expect(artifacts[12]?.content).toContain(
      'ADD CONSTRAINT "document_compilation_attempts_candidate_checkpoint_ck"',
    );
    expect(artifacts[12]?.content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_nodes_artifact_kind_offsets_uq"',
    );
    expect(artifacts[12]?.content).toContain(
      `COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid)`,
    );
    expect(artifacts[12]?.content).not.toContain("vector(1536)");
    expect(artifacts[12]?.content).not.toContain('DELETE FROM "knowledge_nodes"');
    expectMigrationIndexColumns(
      artifacts[12]?.content,
      "postgres",
      "knowledge_nodes_artifact_offset_idx",
      [
        "knowledge_space_id",
        "parse_artifact_id",
        "publication_generation_id",
        "start_offset",
        "id",
      ],
    );
    expect(artifacts[13]?.content).toContain(
      "ADD COLUMN IF NOT EXISTS `publication_generation_id` CHAR(36)",
    );
    expect(artifacts[13]?.content).toContain("ADD CONSTRAINT `knowledge_nodes_pub_gen_nonzero_ck`");
    expect(artifacts[13]?.content).not.toContain(
      "ADD CONSTRAINT `document_compilation_attempts_candidate_checkpoint_ck`",
    );
    expect(artifacts[13]?.content).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_nodes_artifact_kind_offsets_uq`",
    );
    expect(artifacts[13]?.content).toContain("`publication_generation_key`");
    expect(artifacts[13]?.content).not.toContain("CAST(COALESCE");
    expect(artifacts[13]?.content).not.toContain("VECTOR(1536)");
    expect(artifacts[13]?.content).not.toContain("DELETE FROM `knowledge_nodes`");
    expect(artifacts[11]?.content).toContain("`lease_token` CHAR(36)");
    expect(artifacts[11]?.content).toContain("`lock_token` CHAR(36)");
    expect(artifacts[11]?.content).toContain("`lease_token` REGEXP '^[0-9A-Fa-f]{8}-");
    expect(artifacts[11]?.content).toContain("`lock_token` REGEXP '^[0-9A-Fa-f]{8}-");
    expect(artifacts[11]?.content).toContain(
      "AND `lease_token` <> '00000000-0000-0000-0000-000000000000'",
    );
    expect(artifacts[11]?.content).toContain(
      "AND `lock_token` <> '00000000-0000-0000-0000-000000000000'",
    );
  });

  it("keeps migration 0015 safe to replay after DDL commits before its marker", () => {
    const artifacts = getDatabaseMigrationArtifacts();
    const postgres = artifacts.find(
      (artifact) =>
        artifact.path === "packages/database/migrations/0015_research_task_jobs.postgres.sql",
    )?.content;
    const tidb = artifacts.find(
      (artifact) =>
        artifact.path === "packages/database/migrations/0015_research_task_jobs.tidb.sql",
    )?.content;

    expect(postgres).toBeDefined();
    expect(tidb).toBeDefined();
    expect(postgres?.match(/DO \$kfs_0015_[^$]+\$/gu)).toHaveLength(4);
    expect(postgres?.match(/FROM "pg_constraint"/gu)).toHaveLength(4);
    expect(tidb?.match(/FROM information_schema\.tidb_check_constraints/gu)).toHaveLength(2);
    expect(tidb?.match(/FROM information_schema\.referential_constraints/gu)).toHaveLength(2);
    expect(tidb).toContain("table_name = 'research_task_jobs'");
    expect(tidb).toContain("PREPARE kfs_0015_research_task_jobs_statement");
    expect(tidb?.match(/^PREPARE kfs_0015_[^\s]+/gmu)).toHaveLength(5);
    expect(tidb?.match(/'DO 0'/gu)).toHaveLength(5);

    for (const constraint of [
      "knowledge_space_permission_snapshots_api_key_binding_ck",
      "knowledge_space_permission_snapshots_api_key_fk",
      "answer_traces_permission_snapshot_binding_ck",
      "answer_traces_permission_snapshot_fk",
    ]) {
      expect(postgres).toContain(`ADD CONSTRAINT "${constraint}"`);
      expect(tidb).toContain(`ADD CONSTRAINT \`${constraint}\``);
    }
  });

  it("keeps migration 0016 safe to replay after DDL commits before its marker", () => {
    const artifacts = getDatabaseMigrationArtifacts();
    const postgres = artifacts.find(
      (artifact) =>
        artifact.path ===
        "packages/database/migrations/0016_compilation_job_requester_binding.postgres.sql",
    )?.content;
    const tidb = artifacts.find(
      (artifact) =>
        artifact.path ===
        "packages/database/migrations/0016_compilation_job_requester_binding.tidb.sql",
    )?.content;

    expect(postgres).toBeDefined();
    expect(tidb).toBeDefined();
    expect(postgres?.match(/DO \$kfs_0016_[^$]+\$/gu)).toHaveLength(2);
    expect(postgres?.match(/FROM "pg_constraint"/gu)).toHaveLength(2);
    expect(tidb?.match(/FROM information_schema\.tidb_check_constraints/gu)).toHaveLength(1);
    expect(tidb?.match(/FROM information_schema\.referential_constraints/gu)).toHaveLength(1);
    expect(tidb?.match(/^PREPARE kfs_0016_[^\s]+/gmu)).toHaveLength(2);
    expect(tidb?.match(/'DO 0'/gu)).toHaveLength(2);

    for (const constraint of [
      "document_compilation_attempts_permission_binding_ck",
      "document_compilation_attempts_permission_snapshot_fk",
    ]) {
      expect(postgres).toContain(`ADD CONSTRAINT "${constraint}"`);
      expect(tidb).toContain(`ADD CONSTRAINT \`${constraint}\``);
    }
  });

  it("keeps migration 0017 replay-safe and preserves deletion audit rows", () => {
    const artifacts = getDatabaseMigrationArtifacts();
    const postgres = artifacts.find(
      (artifact) =>
        artifact.path === "packages/database/migrations/0017_durable_deletion.postgres.sql",
    )?.content;
    const tidb = artifacts.find(
      (artifact) => artifact.path === "packages/database/migrations/0017_durable_deletion.tidb.sql",
    )?.content;

    expect(postgres).toBeDefined();
    expect(tidb).toBeDefined();
    expect(postgres).toContain('ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1');
    expect(tidb).toContain("ADD COLUMN IF NOT EXISTS `revision` INT NOT NULL DEFAULT 1");
    expect(postgres?.match(/DO \$kfs_0017_[^$]+\$/gu)).toHaveLength(6);
    expect(postgres?.match(/FROM "pg_constraint"/gu)).toHaveLength(6);
    expect(tidb?.match(/FROM information_schema\.tidb_check_constraints/gu)).toHaveLength(4);
    expect(tidb?.match(/FROM information_schema\.referential_constraints/gu)).toHaveLength(2);
    expect(tidb?.match(/FROM information_schema\.tables/gu)).toHaveLength(2);
    expect(tidb?.match(/^PREPARE kfs_0017_[^\s]+/gmu)).toHaveLength(9);
    expect(tidb?.match(/'DO 0'/gu)).toHaveLength(9);
    expect(postgres).toContain('ALTER TABLE "knowledge_space_mutation_leases"');
    expect(postgres).toContain('"expires_at" = "acquired_at"');
    expect(tidb).toContain("ALTER TABLE `knowledge_space_mutation_leases`");
    expect(tidb).toContain("`expires_at` = `acquired_at`");
    expect(postgres).toContain('CREATE TABLE IF NOT EXISTS "retrieval_execution_leases"');
    expect(tidb).toContain("CREATE TABLE `retrieval_execution_leases`");
    expect(postgres).toContain('ADD CONSTRAINT "evidence_bundles_scope_fk"');
    expect(tidb).toContain("ADD CONSTRAINT `evidence_bundles_scope_fk`");
    expect(postgres).toContain("RAISE EXCEPTION\n      'knowledge_space_manifests");
    expect(postgres).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id")\n      REFERENCES "knowledge_spaces" ("tenant_id", "id")',
    );
    expect(postgres).toContain(
      'DROP CONSTRAINT IF EXISTS "knowledge_space_manifests_knowledge_space_id_fkey"',
    );
    expect(tidb).toContain("CREATE TEMPORARY TABLE `kfs_0017_manifest_space_guard`");
    expect(tidb).toContain("FROM information_schema.key_column_usage");
    expect(tidb).toContain("DROP FOREIGN KEY");

    for (const migration of [postgres, tidb]) {
      const jobStart = migration?.indexOf("deletion_jobs") ?? -1;
      const tombstoneStart = migration?.indexOf("deletion_tombstones", jobStart + 1) ?? -1;
      const itemStart = migration?.indexOf("deletion_job_items", tombstoneStart + 1) ?? -1;
      expect(jobStart).toBeGreaterThanOrEqual(0);
      expect(tombstoneStart).toBeGreaterThan(jobStart);
      expect(itemStart).toBeGreaterThan(tombstoneStart);
      expect(migration?.slice(jobStart, tombstoneStart)).not.toContain("FOREIGN KEY");
      expect(migration?.slice(tombstoneStart, itemStart)).not.toContain("FOREIGN KEY");
      expect(migration).toContain("deletion_outbox_job_request_uq");
      expect(migration).toContain("deletion_retry_audits");
      expect(migration).toContain("deletion_retry_audits_owner_rescue_ck");
      expect(migration).toContain("deletion_retry_audits_job_request_uq");
    }
  });

  it("detects missing or drifted checked-in migration artifacts", () => {
    const artifacts = getDatabaseMigrationArtifacts();
    const currentArtifacts = Object.fromEntries(
      artifacts.map((artifact) => [artifact.path, artifact.content]),
    );
    const firstArtifact = artifacts[0];

    if (!firstArtifact) {
      throw new Error("Expected at least one migration artifact");
    }

    expect(findMigrationArtifactDrift(currentArtifacts)).toEqual([]);
    expect(findMigrationArtifactDrift({})).toEqual(artifacts.map((artifact) => artifact.path));
    expect(
      findMigrationArtifactDrift({
        ...currentArtifacts,
        [firstArtifact.path]: `${firstArtifact.content}-- drift\n`,
      }),
    ).toEqual([firstArtifact.path]);
  });

  it("renders a version tracking table and plans only unapplied migrations", () => {
    expect(renderSchemaMigrationsTableSql("postgres")).toContain(
      'CREATE TABLE IF NOT EXISTS "schema_migrations"',
    );
    expect(renderSchemaMigrationsTableSql("tidb")).toContain(
      "CREATE TABLE IF NOT EXISTS `schema_migrations`",
    );

    const pending = getPendingMigrationArtifacts({
      appliedMigrationIds: ["0001_initial_schema"],
      dialect: "postgres",
    });

    expect(pending.map((artifact) => artifact.path)).toEqual([
      "packages/database/migrations/0002_vector_index_upgrade.postgres.sql",
      "packages/database/migrations/0003_projection_set_publications.postgres.sql",
      "packages/database/migrations/0004_projection_publication_members.postgres.sql",
      "packages/database/migrations/0005_publication_generation_nonzero.postgres.sql",
      "packages/database/migrations/0006_document_compilation_attempts.postgres.sql",
      "packages/database/migrations/0007_knowledge_node_generations.postgres.sql",
      "packages/database/migrations/0008_flattened_page_index.postgres.sql",
      "packages/database/migrations/0009_legacy_space_bootstrap.postgres.sql",
      "packages/database/migrations/0010_page_index_upgrade_backfill.postgres.sql",
      "packages/database/migrations/0011_tidb_fts_postings.postgres.sql",
      "packages/database/migrations/0012_tidb_baseline_repair.postgres.sql",
      "packages/database/migrations/0013_space_access_control.postgres.sql",
      "packages/database/migrations/0014_source_credential_refs.postgres.sql",
      "packages/database/migrations/0015_research_task_jobs.postgres.sql",
      "packages/database/migrations/0016_compilation_job_requester_binding.postgres.sql",
      "packages/database/migrations/0017_durable_deletion.postgres.sql",
      "packages/database/migrations/0018_versioned_space_profiles.postgres.sql",
      "packages/database/migrations/0019_profile_publication_bindings.postgres.sql",
      "packages/database/migrations/0020_profile_migration_runs.postgres.sql",
      "packages/database/migrations/0021_source_product_workflows.postgres.sql",
      "packages/database/migrations/0022_logical_document_revisions.postgres.sql",
      "packages/database/migrations/0023_knowledge_space_overview.postgres.sql",
      "packages/database/migrations/0024_quality_control.postgres.sql",
      "packages/database/migrations/0025_capability_grant_provenance.postgres.sql",
      "packages/database/migrations/0026_capability_job_provenance.postgres.sql",
      "packages/database/migrations/0027_upload_sessions.postgres.sql",
      "packages/database/migrations/0028_dify_integration_states.postgres.sql",
      "packages/database/migrations/0029_dify_integration_freezes.postgres.sql",
    ]);
    expect(
      getPendingMigrationArtifacts({
        appliedMigrationIds: [
          "0001_initial_schema",
          "0002_vector_index_upgrade",
          "0003_projection_set_publications",
          "0004_projection_publication_members",
          "0005_publication_generation_nonzero",
          "0006_document_compilation_attempts",
          "0007_knowledge_node_generations",
          "0008_flattened_page_index",
          "0009_legacy_space_bootstrap",
          "0010_page_index_upgrade_backfill",
          "0011_tidb_fts_postings",
          "0012_tidb_baseline_repair",
          "0013_space_access_control",
          "0014_source_credential_refs",
          "0015_research_task_jobs",
          "0016_compilation_job_requester_binding",
          "0017_durable_deletion",
          "0018_versioned_space_profiles",
          "0019_profile_publication_bindings",
          "0020_profile_migration_runs",
          "0021_source_product_workflows",
          "0022_logical_document_revisions",
          "0023_knowledge_space_overview",
          "0024_quality_control",
          "0025_capability_grant_provenance",
          "0026_capability_job_provenance",
          "0027_upload_sessions",
          "0028_dify_integration_states",
          "0029_dify_integration_freezes",
        ],
        dialect: "postgres",
      }),
    ).toEqual([]);
  });
});

function expectMigrationIndexColumns(
  content: string | undefined,
  dialect: "postgres" | "tidb",
  indexName: string,
  expectedColumns: readonly string[],
): void {
  expect(content).toBeDefined();
  const quote = dialect === "postgres" ? '"' : "`";
  const marker = `CREATE INDEX IF NOT EXISTS ${quote}${indexName}${quote}`;
  const start = content?.indexOf(marker) ?? -1;
  expect(start).toBeGreaterThanOrEqual(0);
  const end = content?.indexOf(");", start) ?? -1;
  expect(end).toBeGreaterThan(start);
  const statement = content?.slice(start, end + 2) ?? "";
  const identifierPattern = dialect === "postgres" ? /"([^"]+)"/g : /`([^`]+)`/g;
  const identifiers = [...statement.matchAll(identifierPattern)].map((match) => match[1]);

  expect(identifiers.slice(2)).toEqual(expectedColumns);
}
