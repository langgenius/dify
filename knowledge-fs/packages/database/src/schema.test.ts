import { describe, expect, it } from "vitest";

import {
  type DatabaseSchemaCatalog,
  type IndexDefinition,
  type TableDefinition,
  assertPerformanceIndexes,
  getDatabaseSchema,
  getP9FinalDatabaseSchema,
  renderCreateIndexSql,
  renderCreateTableSql,
  renderMigrationSql,
} from "./schema";

describe("database schema catalog", () => {
  it("declares the first-sprint tables needed for core knowledge and evidence entities", () => {
    const schema = getDatabaseSchema();

    expect(schema.tables.map((table) => table.name)).toEqual([
      "knowledge_spaces",
      "knowledge_space_activity_events",
      "knowledge_space_attention_states",
      "knowledge_space_manifests",
      "knowledge_space_profile_revisions",
      "knowledge_space_profile_heads",
      "projection_set_publications",
      "knowledge_space_profile_publication_bindings",
      "knowledge_space_profile_migration_runs",
      "knowledge_space_profile_migration_outbox",
      "knowledge_space_profile_backfills",
      "source_connections",
      "source_oauth_transactions",
      "source_connection_secret_refs",
      "sources",
      "source_sync_policies",
      "source_workflow_runs",
      "source_workflow_outbox",
      "source_crawl_preview_pages",
      "source_bulk_workflow_items",
      "source_credential_backfills",
      "source_secret_lifecycle_refs",
      "resource_mounts",
      "document_assets",
      "parse_artifacts",
      "document_multimodal_manifests",
      "artifact_segments",
      "knowledge_space_staged_commits",
      "knowledge_fs_sessions",
      "knowledge_fs_leases",
      "retrieval_execution_leases",
      "knowledge_nodes",
      "index_projections",
      "index_projection_fts_postings",
      "tidb_fts_posting_backfills",
      "projection_set_publication_heads",
      "projection_set_publication_members",
      "document_compilation_attempts",
      "logical_documents",
      "document_revisions",
      "document_revision_chunks",
      "document_chunk_state_changes",
      "document_settings_revisions",
      "document_settings_heads",
      "document_reindex_attempts",
      "document_compilation_outbox",
      "deletion_jobs",
      "deletion_tombstones",
      "deletion_job_items",
      "deletion_outbox",
      "deletion_retry_audits",
      "legacy_space_publication_bootstraps",
      "legacy_space_publication_bootstrap_items",
      "knowledge_space_mutation_leases",
      "page_index_upgrade_backfills",
      "page_index_upgrade_backfill_items",
      "embedding_models",
      "knowledge_paths",
      "evidence_bundles",
      "golden_questions",
      "answer_traces",
      "answer_trace_steps",
      "graph_entities",
      "graph_relations",
      "failed_queries",
      "quality_replay_runs",
      "quality_replay_items",
      "quality_replay_outbox",
      "quality_bad_cases",
      "quality_missing_evidence_reviews",
      "quality_resource_history",
      "document_outlines",
      "page_index_manifests",
      "page_index_nodes",
      "page_index_terms",
      "knowledge_space_members",
      "knowledge_space_access_policies",
      "knowledge_space_access_policy_members",
      "knowledge_space_api_access",
      "knowledge_space_api_keys",
      "knowledge_space_permission_snapshots",
      "research_task_jobs",
      "research_task_outbox",
      "research_task_partial_results",
      "research_task_progress_events",
      "agent_workspace_snapshots",
      "capability_grants",
      "capability_space_fences",
      "capability_revoke_receipts",
      "dify_integration_states",
      "dify_integration_freezes",
      "upload_sessions",
      "bulk_operations",
    ]);
  });

  it("models durable bulk task history with exact authorization provenance", () => {
    const schema = getDatabaseSchema();
    const table = findTable(schema, "bulk_operations");

    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "operation_type",
      "items",
      "required_permission_scope",
      "has_not_found_items",
      "capability_grant_id",
      "permission_access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "requested_by_subject_id",
      "created_at",
      "updated_at",
    ]);
    expect(table.foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["tenant_id", "knowledge_space_id", "capability_grant_id"],
          referencedTable: "capability_grants",
        }),
        expect.objectContaining({
          columns: [
            "tenant_id",
            "knowledge_space_id",
            "permission_snapshot_id",
            "requested_by_subject_id",
            "permission_access_channel",
          ],
          referencedTable: "knowledge_space_permission_snapshots",
        }),
      ]),
    );
    expect(findIndex(schema, "bulk_operations_space_created_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "created_at",
      "id",
    ]);
    expect(renderCreateTableSql("postgres", table)).toContain(
      "jsonb_typeof(\"required_permission_scope\") = 'array'",
    );
    expect(renderCreateTableSql("tidb", table)).toContain(
      "JSON_TYPE(`required_permission_scope`) = 'ARRAY'",
    );
  });

  it("models every durable source-product table, relationship, invariant, and hot-path index", () => {
    const schema = getDatabaseSchema();
    const expectedColumns: Readonly<Record<string, readonly string[]>> = {
      source_connections: [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "provider_id",
        "name",
        "auth_kind",
        "status",
        "configuration",
        "credential_ref",
        "scopes",
        "expires_at",
        "last_error_code",
        "version",
        "created_at",
        "updated_at",
      ],
      source_oauth_transactions: [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "connection_id",
        "requested_by_subject_id",
        "access_channel",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "api_key_id",
        "state_hash",
        "verifier_ref",
        "redirect_uri",
        "status",
        "created_at",
        "expires_at",
        "consumed_at",
        "completed_at",
      ],
      source_connection_secret_refs: [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "connection_id",
        "provider_id",
        "credential_ref",
        "purpose",
        "state",
        "remote_revoke_required",
        "recover_after",
        "next_attempt_at",
        "worker_id",
        "lease_token",
        "lease_expires_at",
        "row_version",
        "last_error_code",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      source_sync_policies: [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "source_id",
        "requested_by_subject_id",
        "access_channel",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "required_permission_scope",
        "mode",
        "enabled",
        "custom_interval_seconds",
        "next_run_at",
        "expected_source_version",
        "revision",
        "created_at",
        "updated_at",
      ],
      source_workflow_runs: [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "source_id",
        "source_scope",
        "kind",
        "run_state",
        "checkpoint",
        "payload",
        "cursor",
        "progress_total",
        "progress_completed",
        "progress_skipped",
        "progress_failed",
        "capability_grant_id",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "requested_by_subject_id",
        "required_permission_scope",
        "access_channel",
        "idempotency_key",
        "idempotency_digest",
        "execution_attempts",
        "max_execution_attempts",
        "worker_id",
        "lease_token",
        "lease_expires_at",
        "row_version",
        "active_slot",
        "last_error_code",
        "last_error_message",
        "created_at",
        "updated_at",
        "completed_at",
        "canceled_at",
      ],
      source_workflow_outbox: [
        "id",
        "run_id",
        "delivery_revision",
        "status",
        "available_at",
        "locked_by",
        "lock_token",
        "locked_until",
        "last_error",
        "created_at",
        "updated_at",
        "delivered_at",
      ],
      source_crawl_preview_pages: [
        "id",
        "run_id",
        "page_id",
        "source_url",
        "title",
        "description",
        "etag",
        "content_hash",
        "content_object_key",
        "created_at",
      ],
      source_bulk_workflow_items: [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "run_id",
        "source_id",
        "child_run_id",
        "deletion_job_id",
        "action",
        "status",
        "reason",
        "error_code",
        "updated_at",
      ],
    };
    for (const [tableName, columns] of Object.entries(expectedColumns)) {
      const table = findTable(schema, tableName);
      expect(
        table.columns.map((column) => column.name),
        tableName,
      ).toEqual(columns);
      expect(
        (table.checkConstraints ?? []).map((constraint) => constraint.name),
        tableName,
      ).not.toContain(undefined);
    }
    expect(findTable(schema, "sources").columns.map((column) => column.name)).toContain(
      "connection_id",
    );
    expect(findTable(schema, "sources").foreignKeys).toContainEqual(
      expect.objectContaining({
        columns: ["knowledge_space_id", "connection_id"],
        onDelete: "RESTRICT",
        referencedTable: "source_connections",
      }),
    );
    expect(findTable(schema, "source_crawl_preview_pages").primaryKey).toEqual(["run_id", "id"]);
    expect(findTable(schema, "source_bulk_workflow_items").foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id", "child_run_id"],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
      referencedTable: "source_workflow_runs",
    });
    expect(findTable(schema, "source_bulk_workflow_items").foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id", "deletion_job_id"],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
      referencedTable: "deletion_jobs",
    });
    expect(findTable(schema, "source_bulk_workflow_items").foreignKeys).not.toContainEqual(
      expect.objectContaining({
        columns: ["knowledge_space_id", "source_id"],
        referencedTable: "sources",
      }),
    );
    expect(
      findTable(schema, "source_bulk_workflow_items").checkConstraints?.map(
        (constraint) => constraint.name,
      ),
    ).toContain("source_bulk_workflow_items_child_ck");

    const requiredIndexes = [
      "source_connections_scope_id_uq",
      "source_connections_space_id_uq",
      "source_connections_credential_ref_uq",
      "source_connections_scope_status_idx",
      "source_oauth_transactions_state_hash_uq",
      "source_oauth_transactions_verifier_ref_uq",
      "source_oauth_transactions_expiry_idx",
      "source_connection_secret_refs_ref_uq",
      "source_connection_secret_refs_claim_idx",
      "source_connection_secret_refs_scope_idx",
      "sources_connection_idx",
      "source_sync_policies_source_uq",
      "source_sync_policies_due_idx",
      "source_workflow_runs_idempotency_digest_uq",
      "source_workflow_runs_scope_id_uq",
      "source_workflow_runs_active_uq",
      "source_workflow_runs_claim_idx",
      "source_workflow_runs_history_idx",
      "source_workflow_outbox_delivery_uq",
      "source_workflow_outbox_claim_idx",
      "source_crawl_preview_pages_page_uq",
      "source_bulk_workflow_items_source_uq",
      "source_bulk_workflow_items_child_uq",
      "source_bulk_workflow_items_deletion_job_uq",
      "source_bulk_workflow_items_list_idx",
      "deletion_jobs_scope_id_uq",
    ];
    expect(schema.indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(requiredIndexes),
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "source_crawl_preview_pages")),
    ).toContain('PRIMARY KEY ("run_id", "id")');
  });

  it("models tenant-scoped immutable profile revisions, CAS heads, and fenced legacy backfills", () => {
    const schema = getDatabaseSchema();
    const revisions = findTable(schema, "knowledge_space_profile_revisions");
    const heads = findTable(schema, "knowledge_space_profile_heads");
    const backfills = findTable(schema, "knowledge_space_profile_backfills");

    expect(revisions.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "kind",
      "revision",
      "state",
      "snapshot",
      "snapshot_digest",
      "capability_snapshot",
      "capability_snapshot_digest",
      "plugin_id",
      "provider",
      "model",
      "vector_space_id",
      "dimension",
      "created_by_subject_id",
      "failure_code",
      "failure_message",
      "created_at",
      "updated_at",
      "activated_at",
      "superseded_at",
      "failed_at",
    ]);
    expect(revisions.foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id"],
      onDelete: "CASCADE",
      referencedColumns: ["tenant_id", "id"],
      referencedTable: "knowledge_spaces",
    });
    expect(heads.foreignKeys).toContainEqual({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "kind",
        "profile_revision_id",
        "active_revision",
      ],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "kind", "id", "revision"],
      referencedTable: "knowledge_space_profile_revisions",
    });
    expect(findIndex(schema, "knowledge_space_profile_revisions_scope_revision_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "kind", "revision"],
      unique: true,
    });
    expect(findIndex(schema, "knowledge_space_profile_heads_scope_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "kind"],
      unique: true,
    });
    expect(findIndex(schema, "knowledge_space_profile_revisions_head_fk_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "kind", "id", "revision"],
      unique: true,
    });
    expect(findIndex(schema, "knowledge_space_profile_backfills_source_uq")).toMatchObject({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "kind",
        "source_manifest_version",
        "source_snapshot_digest",
      ],
      unique: true,
    });
    expect(backfills.checkConstraints?.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "knowledge_space_profile_backfills_lease_ck",
        "knowledge_space_profile_backfills_lifecycle_ck",
        "knowledge_space_profile_backfills_lease_token_ck",
      ]),
    );

    const postgres = renderCreateTableSql("postgres", revisions);
    const tidb = renderCreateTableSql("tidb", revisions);
    expect(postgres).toContain('"dimension" INTEGER');
    expect(tidb).toContain("`dimension` INT");
    expect(postgres).not.toContain("1536");
    expect(tidb).not.toContain("1536");
    expect(postgres).toContain('"plugin_id" VARCHAR(256)');
    expect(tidb).toContain("`vector_space_id` VARCHAR(87)");
  });

  it("models one durable, permission-bound profile migration per knowledge space", () => {
    const schema = getDatabaseSchema();
    const runs = findTable(schema, "knowledge_space_profile_migration_runs");
    const outbox = findTable(schema, "knowledge_space_profile_migration_outbox");

    expect(runs.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "candidate_profile_kind",
        "candidate_profile_revision_id",
        "candidate_profile_snapshot_digest",
        "base_publication_fingerprint",
        "permission_snapshot_revision",
        "active_slot",
        "checkpoint",
        "lease_token",
      ]),
    );
    expect(runs.foreignKeys).toContainEqual({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "permission_snapshot_id",
        "requested_by_subject_id",
        "access_channel",
      ],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"],
      referencedTable: "knowledge_space_permission_snapshots",
    });
    expect(findIndex(schema, "knowledge_space_profile_migration_runs_active_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "active_slot"],
      unique: true,
    });
    expect(findIndex(schema, "knowledge_space_profile_migration_outbox_delivery_uq")).toMatchObject(
      {
        columns: ["run_id", "delivery_revision"],
        unique: true,
      },
    );
    expect(outbox.foreignKeys).toContainEqual({
      columns: ["run_id"],
      onDelete: "CASCADE",
      referencedColumns: ["id"],
      referencedTable: "knowledge_space_profile_migration_runs",
    });

    expect(renderCreateTableSql("postgres", runs)).toContain(
      '"base_publication_fingerprint" VARCHAR(86)',
    );
    expect(renderCreateTableSql("tidb", runs)).toContain(
      "`candidate_publication_fingerprint` VARCHAR(86)",
    );
  });

  it("models durable, invalidatable Agent workspace snapshots with exact authorization provenance", () => {
    const schema = getDatabaseSchema();
    const snapshots = findTable(schema, "agent_workspace_snapshots");

    expect(snapshots.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "subject_id",
      "access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "permission_scopes",
      "fingerprint",
      "payload",
      "invalidated_at",
      "invalidation_reason",
      "created_at",
    ]);
    expect(snapshots.foreignKeys).toEqual([
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ]);
    expect(findIndex(schema, "agent_workspace_snapshots_space_cleanup_idx")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "invalidated_at", "id"],
    });
  });

  it("models replay-safe durable deletion without retaining target foreign keys", () => {
    const schema = getDatabaseSchema();
    const jobs = findTable(schema, "deletion_jobs");
    const tombstones = findTable(schema, "deletion_tombstones");
    const items = findTable(schema, "deletion_job_items");
    const outbox = findTable(schema, "deletion_outbox");
    const retryAudits = findTable(schema, "deletion_retry_audits");

    expect(jobs.foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id", "capability_grant_id"],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "grant_id"],
      referencedTable: "capability_grants",
    });
    expect(tombstones.foreignKeys ?? []).toEqual([]);
    expect(items.foreignKeys).toEqual([
      {
        columns: ["deletion_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "deletion_jobs",
      },
    ]);
    expect(outbox.foreignKeys).toEqual(items.foreignKeys);
    expect(retryAudits.foreignKeys).toEqual([
      ...(items.foreignKeys ?? []),
      {
        columns: ["tenant_id", "knowledge_space_id", "capability_grant_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "grant_id"],
        referencedTable: "capability_grants",
      },
    ]);
    expect(jobs.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "target_revision",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "api_key_id",
        "api_key_revision",
        "api_key_expires_at",
        "request_fingerprint",
        "lease_token",
        "row_version",
      ]),
    );
    expect(outbox.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "delivery_revision",
        "request_idempotency_key",
        "request_fingerprint",
        "lock_token",
      ]),
    );
    expect(findIndex(schema, "deletion_jobs_idempotency_uq")).toMatchObject({
      columns: ["tenant_id", "idempotency_key"],
      unique: true,
    });
    expect(findIndex(schema, "deletion_jobs_target_active_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "target_type", "target_id", "active_slot"],
      unique: true,
    });
    expect(findIndex(schema, "deletion_tombstones_target_uq")).toMatchObject({
      columns: ["tenant_id", "target_type", "target_id"],
      unique: true,
    });
    expect(findIndex(schema, "deletion_outbox_job_request_uq")).toMatchObject({
      columns: ["deletion_job_id", "request_idempotency_key"],
      unique: true,
    });
    expect(retryAudits.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "retry_authority",
        "capability_grant_id",
        "actor_subject_id",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "access_channel",
        "request_idempotency_key",
        "request_fingerprint",
      ]),
    );
    expect(findIndex(schema, "deletion_retry_audits_job_request_uq")).toMatchObject({
      columns: ["deletion_job_id", "request_idempotency_key"],
      unique: true,
    });
    expect(findIndex(schema, "deletion_retry_audits_capability_grant_idx")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "capability_grant_id"],
    });
    expect(
      findTable(schema, "knowledge_space_mutation_leases").columns.map((column) => column.name),
    ).toEqual(expect.arrayContaining(["lease_token", "heartbeat_at", "expires_at"]));
  });

  it("models tenant-scoped, replay-safe durable Research progress", () => {
    const progress = findTable(getDatabaseSchema(), "research_task_progress_events");

    expect(progress.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "research_task_job_id",
      "sequence",
      "idempotency_key",
      "event_type",
      "stage",
      "payload",
      "created_at",
    ]);
    expect(progress.checkConstraints?.map((constraint) => constraint.name)).toEqual([
      "research_task_progress_sequence_ck",
      "research_task_progress_event_ck",
      "research_task_progress_stage_ck",
    ]);
    expect(progress.foreignKeys).toEqual([
      {
        columns: ["tenant_id", "knowledge_space_id", "research_task_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "research_task_jobs",
      },
    ]);
  });

  it("guards high-traffic access patterns with explicit indexes", () => {
    const result = assertPerformanceIndexes(getDatabaseSchema());

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("models opaque source credentials and restart-safe legacy credential backfill", () => {
    const schema = getDatabaseSchema();
    const sources = findTable(schema, "sources");
    const jobs = findTable(schema, "source_credential_backfills");
    const lifecycle = findTable(schema, "source_secret_lifecycle_refs");
    const sourceRef = sources.columns.find((column) => column.name === "credential_ref");

    expect(sourceRef).toEqual({
      name: "credential_ref",
      nullable: true,
      type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
    });
    expect(jobs.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "source_id",
      "source_version",
      "candidate_credential_ref",
      "secret_fingerprint",
      "run_state",
      "worker_id",
      "lease_token",
      "lease_expires_at",
      "heartbeat_at",
      "retry_count",
      "row_version",
      "last_error_code",
      "last_error_message",
      "created_at",
      "updated_at",
      "completed_at",
    ]);
    expect(jobs.checkConstraints?.map((constraint) => constraint.name)).toEqual([
      "source_credential_backfills_source_version_ck",
      "source_credential_backfills_counts_ck",
      "source_credential_backfills_state_ck",
      "source_credential_backfills_lease_ck",
      "source_credential_backfills_terminal_ck",
    ]);
    expect(jobs.foreignKeys).toEqual([
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "source_id"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "sources",
      },
    ]);
    expect(lifecycle.foreignKeys ?? []).toEqual([]);
    expect(lifecycle.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "source_id",
      "credential_ref",
      "operation_id",
      "purpose",
      "state",
      "source_version",
      "recover_after",
      "next_delete_at",
      "worker_id",
      "lease_token",
      "lease_expires_at",
      "heartbeat_at",
      "delete_attempts",
      "row_version",
      "last_error_code",
      "last_error_message",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    expect(lifecycle.checkConstraints?.map((constraint) => constraint.name)).toEqual([
      "source_secret_lifecycle_refs_source_version_ck",
      "source_secret_lifecycle_refs_purpose_ck",
      "source_secret_lifecycle_refs_counts_ck",
      "source_secret_lifecycle_refs_state_ck",
      "source_secret_lifecycle_refs_lease_ck",
      "source_secret_lifecycle_refs_terminal_ck",
    ]);

    const postgresTable = renderCreateTableSql("postgres", jobs);
    const tidbTable = renderCreateTableSql("tidb", jobs);
    expect(postgresTable).toContain('"candidate_credential_ref" TEXT NOT NULL');
    expect(postgresTable).toContain('"secret_fingerprint" CHAR(64) NOT NULL');
    expect(postgresTable).toContain(
      'CONSTRAINT "source_credential_backfills_lease_ck" CHECK ((("run_state" = \'running\'',
    );
    expect(tidbTable).toContain("`candidate_credential_ref` VARCHAR(255) NOT NULL");
    expect(tidbTable).toContain("`worker_id` VARCHAR(255)");
    expect(tidbTable).toContain(
      "FOREIGN KEY (`knowledge_space_id`, `source_id`) REFERENCES `sources` (`knowledge_space_id`, `id`) ON DELETE CASCADE",
    );

    const expectedIndexes = [
      ["sources_credential_ref_uq", ["credential_ref"], true],
      ["sources_credential_backfill_discovery_idx", ["id"], false],
      ["sources_space_id_uq", ["knowledge_space_id", "id"], true],
      [
        "source_credential_backfills_source_uq",
        ["tenant_id", "knowledge_space_id", "source_id"],
        true,
      ],
      ["source_credential_backfills_candidate_ref_uq", ["candidate_credential_ref"], true],
      [
        "source_credential_backfills_claim_idx",
        ["run_state", "lease_expires_at", "updated_at", "id"],
        false,
      ],
      [
        "source_credential_backfills_scope_idx",
        ["tenant_id", "knowledge_space_id", "source_id", "id"],
        false,
      ],
      ["source_secret_lifecycle_refs_ref_uq", ["credential_ref"], true],
      ["source_secret_lifecycle_refs_operation_idx", ["operation_id", "state", "id"], false],
      [
        "source_secret_lifecycle_refs_claim_idx",
        ["state", "next_delete_at", "lease_expires_at", "updated_at", "id"],
        false,
      ],
      ["source_secret_lifecycle_refs_recovery_idx", ["state", "recover_after", "id"], false],
      [
        "source_secret_lifecycle_refs_scope_idx",
        ["tenant_id", "knowledge_space_id", "source_id", "id"],
        false,
      ],
    ] as const;
    for (const [name, columns, unique] of expectedIndexes) {
      const index = findIndex(schema, name);
      expect(index.columns, name).toEqual(columns);
      expect(index.unique ?? false, name).toBe(unique);
    }

    expect(renderCreateIndexSql("postgres", findIndex(schema, "sources_credential_ref_uq"))).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "sources_credential_ref_uq" ON "sources" ("credential_ref") WHERE "credential_ref" IS NOT NULL;',
    );
    expect(renderCreateIndexSql("tidb", findIndex(schema, "sources_credential_ref_uq"))).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS `sources_credential_ref_uq` ON `sources` (`credential_ref`);",
    );
    expect(
      renderCreateIndexSql(
        "postgres",
        findIndex(schema, "sources_credential_backfill_discovery_idx"),
      ),
    ).toBe(
      'CREATE INDEX IF NOT EXISTS "sources_credential_backfill_discovery_idx" ON "sources" ("id") WHERE "credential_ref" IS NULL;',
    );
    expect(
      renderCreateIndexSql("tidb", findIndex(schema, "sources_credential_backfill_discovery_idx")),
    ).toBe(
      "CREATE INDEX IF NOT EXISTS `sources_credential_backfill_discovery_idx` ON `sources` (`credential_ref`, `id`);",
    );
    expect(
      renderCreateIndexSql("postgres", findIndex(schema, "source_credential_backfills_claim_idx")),
    ).toBe(
      'CREATE INDEX IF NOT EXISTS "source_credential_backfills_claim_idx" ON "source_credential_backfills" ("run_state", "lease_expires_at", "updated_at", "id");',
    );
  });

  it("models tenant-safe ACL, API access, hash-only keys, and durable permission snapshots", () => {
    const schema = getDatabaseSchema();
    const policy = findTable(schema, "knowledge_space_access_policies");
    const apiAccess = findTable(schema, "knowledge_space_api_access");
    const apiKeys = findTable(schema, "knowledge_space_api_keys");
    const snapshots = findTable(schema, "knowledge_space_permission_snapshots");
    const answerTraces = findTable(schema, "answer_traces");

    expect(policy.foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id", "owner_subject_id"],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "subject_id"],
      referencedTable: "knowledge_space_members",
    });
    expect(apiAccess.columns.map((column) => column.name)).toContain("disabled_at");
    expect(apiAccess.checkConstraints?.map((constraint) => constraint.name)).toContain(
      "knowledge_space_api_access_disabled_ck",
    );
    expect(apiKeys.columns.map((column) => column.name)).toContain("key_hash");
    expect(apiKeys.columns.map((column) => column.name)).not.toContain("plaintext_key");
    expect(snapshots.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "member_revision",
        "access_policy_revision",
        "api_access_revision",
        "permission_scopes",
        "expires_at",
        "revoked_at",
      ]),
    );
    expect(snapshots.checkConstraints?.map((constraint) => constraint.name)).toContain(
      "knowledge_space_permission_snapshots_api_key_binding_ck",
    );
    expect(snapshots.foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id", "api_key_id"],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
      referencedTable: "knowledge_space_api_keys",
    });
    expect(findIndex(schema, "knowledge_space_permission_snapshots_provenance_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"],
      unique: true,
    });
    expect(
      findIndex(schema, "knowledge_space_permission_snapshots_trace_provenance_uq"),
    ).toMatchObject({
      columns: ["knowledge_space_id", "id", "subject_id", "access_channel"],
      unique: true,
    });
    expect(findTable(schema, "research_task_jobs").foreignKeys).toContainEqual({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "permission_snapshot_id",
        "subject_id",
        "access_channel",
      ],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"],
      referencedTable: "knowledge_space_permission_snapshots",
    });
    expect(answerTraces.checkConstraints?.map((constraint) => constraint.name)).toContain(
      "answer_traces_authorization_binding_ck",
    );
    expect(answerTraces.foreignKeys).toContainEqual({
      columns: ["knowledge_space_id", "permission_snapshot_id", "subject_id", "access_channel"],
      onDelete: "RESTRICT",
      referencedColumns: ["knowledge_space_id", "id", "subject_id", "access_channel"],
      referencedTable: "knowledge_space_permission_snapshots",
    });
    expect(findIndex(schema, "knowledge_space_api_keys_hash_uq").unique).toBe(true);
    expect(findIndex(schema, "knowledge_space_api_keys_scope_created_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "created_at",
      "id",
    ]);
  });

  it("keeps every TiDB key column bounded and renders no unsupported expression index", () => {
    const schema = getDatabaseSchema();

    for (const index of schema.indexes.filter(
      (candidate) => !candidate.dialects || candidate.dialects.includes("tidb"),
    )) {
      const table = findTable(schema, index.tableName);
      const columns = index.columnsByDialect?.tidb ?? index.columns;
      for (const columnName of columns) {
        const column = table.columns.find((candidate) => candidate.name === columnName);
        expect(column, `${index.name}.${columnName}`).toBeDefined();
        expect(column?.type.tidb, `${index.name}.${columnName}`).not.toMatch(
          /(?:^|\s)(?:BLOB|JSON|TEXT)(?:\s|$)/iu,
        );
      }

      const sql = renderCreateIndexSql("tidb", index);
      expect(sql, index.name).not.toMatch(/\((?:CAST|COALESCE)\(/u);
      expect(sql, index.name).not.toContain("FULLTEXT INDEX");
    }

    for (const table of schema.tables) {
      for (const foreignKey of table.foreignKeys ?? []) {
        const referencedTable = findTable(schema, foreignKey.referencedTable);
        for (const columnName of foreignKey.columns) {
          const column = table.columns.find((candidate) => candidate.name === columnName);
          expect(column?.type.tidb, `${table.name}.${columnName}`).not.toMatch(
            /(?:^|\s)(?:BLOB|JSON|TEXT)(?:\s|$)/iu,
          );
        }
        for (const columnName of foreignKey.referencedColumns) {
          const column = referencedTable.columns.find((candidate) => candidate.name === columnName);
          expect(column?.type.tidb, `${referencedTable.name}.${columnName}`).not.toMatch(
            /(?:^|\s)(?:BLOB|JSON|TEXT)(?:\s|$)/iu,
          );
        }
      }
    }
  });

  it("keeps the corrected TiDB baseline aligned with the forward repair contract", () => {
    const schema = getDatabaseSchema();
    const expectedColumns = [
      ["knowledge_spaces", "tenant_id", "VARCHAR(255)"],
      ["knowledge_spaces", "slug", "VARCHAR(160)"],
      ["resource_mounts", "mount_path", "VARCHAR(384)"],
      ["knowledge_nodes", "kind", "VARCHAR(16)"],
      ["index_projections", "model", "VARCHAR(255)"],
      ["index_projections", "fts_document", "TEXT"],
      ["knowledge_paths", "target_id", "VARCHAR(512)"],
      ["graph_entities", "canonical_key", "VARCHAR(512)"],
    ] as const;

    for (const [tableName, columnName, tidbType] of expectedColumns) {
      const column = findTable(schema, tableName).columns.find(
        (candidate) => candidate.name === columnName,
      );
      expect(column?.type.tidb, `${tableName}.${columnName}`).toBe(tidbType);
    }

    for (const [tableName, columnName] of [
      ["index_projections", "model_key"],
      ["index_projections", "publication_generation_key"],
      ["document_multimodal_manifests", "publication_generation_key"],
      ["knowledge_nodes", "publication_generation_key"],
      ["knowledge_paths", "publication_generation_key"],
      ["graph_entities", "publication_generation_key"],
      ["graph_relations", "publication_generation_key"],
      ["document_outlines", "publication_generation_key"],
    ] as const) {
      const column = findTable(schema, tableName).columns.find(
        (candidate) => candidate.name === columnName,
      );
      expect(column?.generatedAs?.tidb, `${tableName}.${columnName}`).toContain("COALESCE(");
    }
  });

  it("keeps keyset pagination indexes stable with primary-key tie-breakers", () => {
    const schema = getDatabaseSchema();

    expect(findIndex(schema, "document_assets_space_status_created_idx").columns).toEqual([
      "knowledge_space_id",
      "parser_status",
      "created_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_nodes_artifact_offset_idx").columns).toEqual([
      "knowledge_space_id",
      "parse_artifact_id",
      "publication_generation_id",
      "start_offset",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_nodes_space_asset_kind_idx").columns).toEqual([
      "knowledge_space_id",
      "publication_generation_id",
      "document_asset_id",
      "kind",
      "id",
    ]);
    expect(findIndex(schema, "answer_trace_steps_trace_started_idx").columns).toEqual([
      "trace_id",
      "started_at",
      "id",
    ]);
    expect(findIndex(schema, "golden_questions_space_created_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "created_at",
      "id",
    ]);
    expect(findIndex(schema, "index_projections_space_type_status_idx").columns).toEqual([
      "knowledge_space_id",
      "publication_generation_id",
      "type",
      "status",
      "node_id",
      "id",
    ]);
    expect(findIndex(schema, "index_projection_fts_postings_lookup_idx").columns).toEqual([
      "knowledge_space_id",
      "term_hash",
      "projection_id",
    ]);
    expect(findIndex(schema, "index_projections_fts_backfill_idx").columns).toEqual([
      "knowledge_space_id",
      "type",
      "id",
    ]);
    expect(findIndex(schema, "tidb_fts_posting_backfills_claim_idx").columns).toEqual([
      "run_state",
      "lease_expires_at",
      "updated_at",
      "id",
    ]);
    expect(
      findIndex(schema, "projection_set_publications_space_status_updated_idx").columns,
    ).toEqual(["tenant_id", "knowledge_space_id", "status", "updated_at", "fingerprint", "id"]);
    expect(findIndex(schema, "projection_set_publication_heads_space_uq").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
    ]);
    expect(findIndex(schema, "document_compilation_attempts_run_schedule_idx").columns).toEqual([
      "run_state",
      "retry_at",
      "created_at",
      "id",
    ]);
    expect(findIndex(schema, "document_compilation_attempts_lease_recovery_idx").columns).toEqual([
      "run_state",
      "lease_expires_at",
      "heartbeat_at",
      "id",
    ]);
    expect(findIndex(schema, "document_compilation_attempts_document_version_idx").columns).toEqual(
      ["knowledge_space_id", "document_asset_id", "document_version", "id"],
    );
    expect(findIndex(schema, "document_compilation_attempts_candidate_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "candidate_publication_id",
      "candidate_fingerprint",
      "id",
    ]);
    expect(findIndex(schema, "document_compilation_attempts_tenant_completed_idx").columns).toEqual(
      ["tenant_id", "completed_at", "id"],
    );
    expect(findIndex(schema, "document_compilation_outbox_delivery_due_idx").columns).toEqual([
      "status",
      "available_at",
      "created_at",
      "id",
    ]);
    expect(findIndex(schema, "document_compilation_outbox_lock_recovery_idx").columns).toEqual([
      "status",
      "locked_until",
      "created_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_paths_space_view_path_idx").columns).toEqual([
      "knowledge_space_id",
      "publication_generation_id",
      "view_type",
      "view_name",
      "virtual_path",
      "id",
    ]);
    expect(findIndex(schema, "resource_mounts_space_path_uq").columns).toEqual([
      "knowledge_space_id",
      "mount_path",
    ]);
    expect(findIndex(schema, "resource_mounts_space_type_path_idx").columns).toEqual([
      "knowledge_space_id",
      "resource_type",
      "mount_path",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_space_manifests_tenant_space_uq").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
    ]);
    expect(findIndex(schema, "knowledge_space_manifests_tenant_space_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_space_staged_commits_idempotency_uq").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "idempotency_key",
    ]);
    expect(findIndex(schema, "knowledge_space_staged_commits_status_updated_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "status",
      "updated_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_space_staged_commits_expiry_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "expires_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_fs_sessions_space_expiry_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "expires_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_fs_sessions_expiry_idx").columns).toEqual([
      "tenant_id",
      "expires_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_fs_leases_active_path_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "status",
      "virtual_path",
      "expires_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_fs_leases_expiry_idx").columns).toEqual([
      "tenant_id",
      "expires_at",
      "id",
    ]);
    expect(findIndex(schema, "knowledge_fs_leases_session_idx").columns).toEqual([
      "tenant_id",
      "session_id",
      "status",
      "id",
    ]);
    expect(findIndex(schema, "artifact_segments_artifact_index_uq").columns).toEqual([
      "parse_artifact_id",
      "segment_index",
    ]);
    expect(findIndex(schema, "artifact_segments_space_artifact_index_idx").columns).toEqual([
      "knowledge_space_id",
      "parse_artifact_id",
      "segment_index",
      "id",
    ]);
    expect(findIndex(schema, "artifact_segments_space_checksum_idx").columns).toEqual([
      "knowledge_space_id",
      "checksum",
      "id",
    ]);
    expect(findIndex(schema, "artifact_segments_document_source_idx").columns).toEqual([
      "document_asset_id",
      "start_offset",
      "id",
    ]);
    expect(findIndex(schema, "graph_entities_space_type_name_idx").columns).toEqual([
      "knowledge_space_id",
      "publication_generation_id",
      "type",
      "name",
      "id",
    ]);
    expect(findIndex(schema, "graph_relations_subject_traversal_idx").columns).toEqual([
      "knowledge_space_id",
      "publication_generation_id",
      "subject_entity_id",
      "type",
      "object_entity_id",
      "id",
    ]);
    expect(findIndex(schema, "graph_relations_object_traversal_idx").columns).toEqual([
      "knowledge_space_id",
      "publication_generation_id",
      "object_entity_id",
      "type",
      "subject_entity_id",
      "id",
    ]);
  });

  it("isolates knowledge-node logical identities by immutable publication generation", () => {
    const schema = getDatabaseSchema();
    const table = findTable(schema, "knowledge_nodes");
    const logicalIndex = findIndex(schema, "knowledge_nodes_artifact_kind_offsets_uq");

    expect(table.columns.map((column) => column.name)).toContain("publication_generation_id");
    expect(table.checkConstraints?.map((constraint) => constraint.name)).toContain(
      "knowledge_nodes_pub_gen_nonzero_ck",
    );
    expect(renderCreateTableSql("postgres", table)).toContain('"publication_generation_id" UUID');
    expect(renderCreateTableSql("postgres", table)).toContain(
      'CONSTRAINT "knowledge_nodes_pub_gen_nonzero_ck" CHECK ("publication_generation_id" IS NULL OR "publication_generation_id" <> \'00000000-0000-0000-0000-000000000000\'::uuid)',
    );
    expect(logicalIndex).toMatchObject({
      columns: [
        "knowledge_space_id",
        "parse_artifact_id",
        "kind",
        "start_offset",
        "end_offset",
        "publication_generation_id",
      ],
      unique: true,
    });
    expect(renderCreateIndexSql("postgres", logicalIndex)).toContain(
      `(COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))`,
    );
    expect(renderCreateTableSql("tidb", table)).toContain(
      "`publication_generation_key` CHAR(36) GENERATED ALWAYS AS",
    );
    expect(renderCreateIndexSql("tidb", logicalIndex)).toContain(
      "`kind`, `start_offset`, `end_offset`, `publication_generation_key`",
    );
  });

  it("declares critical foreign key constraints in generated table SQL", () => {
    const schema = getDatabaseSchema();

    expect(renderCreateTableSql("postgres", findTable(schema, "knowledge_nodes"))).toContain(
      'FOREIGN KEY ("parse_artifact_id") REFERENCES "parse_artifacts" ("id") ON DELETE CASCADE',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "knowledge_space_manifests")),
    ).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id") REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE',
    );
    expect(renderCreateTableSql("postgres", findTable(schema, "graph_relations"))).toContain(
      'FOREIGN KEY ("subject_entity_id") REFERENCES "graph_entities" ("id") ON DELETE CASCADE',
    );
    expect(renderCreateTableSql("tidb", findTable(schema, "document_assets"))).toContain(
      "FOREIGN KEY (`knowledge_space_id`) REFERENCES `knowledge_spaces` (`id`) ON DELETE CASCADE",
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "knowledge_space_staged_commits")),
    ).toContain(
      'FOREIGN KEY ("document_asset_id") REFERENCES "document_assets" ("id") ON DELETE SET NULL',
    );
    expect(renderCreateTableSql("postgres", findTable(schema, "artifact_segments"))).toContain(
      'FOREIGN KEY ("parse_artifact_id") REFERENCES "parse_artifacts" ("id") ON DELETE CASCADE',
    );
    expect(renderCreateTableSql("postgres", findTable(schema, "knowledge_fs_sessions"))).toContain(
      'FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE',
    );
    expect(renderCreateTableSql("postgres", findTable(schema, "knowledge_fs_leases"))).toContain(
      'FOREIGN KEY ("session_id") REFERENCES "knowledge_fs_sessions" ("id") ON DELETE CASCADE',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "projection_set_publications")),
    ).toContain(
      'FOREIGN KEY ("knowledge_space_id") REFERENCES "knowledge_spaces" ("id") ON DELETE CASCADE',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "projection_set_publication_heads")),
    ).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id", "publication_id") REFERENCES "projection_set_publications" ("tenant_id", "knowledge_space_id", "id") ON DELETE RESTRICT',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "projection_set_publication_members")),
    ).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id", "publication_id") REFERENCES "projection_set_publications" ("tenant_id", "knowledge_space_id", "id") ON DELETE CASCADE',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "document_compilation_attempts")),
    ).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id") REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "document_compilation_attempts")),
    ).toContain(
      'FOREIGN KEY ("knowledge_space_id", "document_asset_id", "document_version") REFERENCES "document_assets" ("knowledge_space_id", "id", "version") ON DELETE CASCADE',
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "document_compilation_attempts")),
    ).toContain(
      'FOREIGN KEY ("tenant_id", "knowledge_space_id", "candidate_publication_id", "candidate_fingerprint") REFERENCES "projection_set_publications" ("tenant_id", "knowledge_space_id", "id", "fingerprint") ON DELETE RESTRICT',
    );
    expect(renderCreateTableSql("tidb", findTable(schema, "research_task_jobs"))).toContain(
      "FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `permission_snapshot_id`, `subject_id`, `access_channel`) REFERENCES `knowledge_space_permission_snapshots` (`tenant_id`, `knowledge_space_id`, `id`, `subject_id`, `access_channel`)",
    );
    expect(renderCreateTableSql("tidb", findTable(schema, "research_task_jobs"))).not.toContain(
      "ON DELETE RESTRICT",
    );
    expect(
      renderCreateTableSql("postgres", findTable(schema, "document_compilation_outbox")),
    ).toContain(
      'FOREIGN KEY ("attempt_id") REFERENCES "document_compilation_attempts" ("id") ON DELETE CASCADE',
    );
  });

  it("declares tenant-scoped projection publication history and one CAS head per space", () => {
    const schema = getDatabaseSchema();
    const publicationTable = findTable(schema, "projection_set_publications");
    const headTable = findTable(schema, "projection_set_publication_heads");

    expect(publicationTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "fingerprint",
      "projection_version",
      "status",
      "superseded_by_fingerprint",
      "metadata",
      "created_at",
      "updated_at",
    ]);
    expect(headTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "publication_id",
      "head_revision",
      "created_at",
      "updated_at",
    ]);
    expect(findIndex(schema, "projection_set_publications_space_fingerprint_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "fingerprint"],
      unique: true,
    });
    expect(findIndex(schema, "projection_set_publications_space_id_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "id"],
      unique: true,
    });
    expect(findIndex(schema, "projection_set_publication_heads_space_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id"],
      unique: true,
    });
    expect(findIndex(schema, "projection_set_publication_heads_publication_uq")).toMatchObject({
      columns: ["publication_id"],
      unique: true,
    });
    const postgresPublicationSql = renderCreateTableSql("postgres", publicationTable);
    const postgresHeadSql = renderCreateTableSql("postgres", headTable);
    const tidbPublicationSql = renderCreateTableSql("tidb", publicationTable);
    const tidbHeadSql = renderCreateTableSql("tidb", headTable);

    expect(postgresHeadSql).toContain('"head_revision" INTEGER NOT NULL');
    expect(postgresPublicationSql).toContain('"tenant_id" VARCHAR(255) NOT NULL');
    expect(postgresPublicationSql).toContain('"fingerprint" VARCHAR(86) NOT NULL');
    expect(postgresPublicationSql).toContain('"status" VARCHAR(16) NOT NULL');
    expect(postgresPublicationSql).toContain(
      "CONSTRAINT \"projection_set_publications_status_ck\" CHECK (\"status\" IN ('candidate', 'inactive', 'published', 'superseded', 'validating'))",
    );
    expect(postgresPublicationSql).toContain('"superseded_by_fingerprint" VARCHAR(86)');
    expect(postgresHeadSql).toContain('"tenant_id" VARCHAR(255) NOT NULL');
    expect(tidbPublicationSql).toContain("`tenant_id` VARCHAR(255) NOT NULL");
    expect(tidbPublicationSql).toContain("`fingerprint` VARCHAR(86) NOT NULL");
    expect(tidbPublicationSql).toContain("`status` VARCHAR(16) NOT NULL");
    expect(tidbPublicationSql).toContain(
      "CONSTRAINT `projection_set_publications_status_ck` CHECK (`status` IN ('candidate', 'inactive', 'published', 'superseded', 'validating'))",
    );
    expect(tidbPublicationSql).toContain("`superseded_by_fingerprint` VARCHAR(86)");
    expect(tidbPublicationSql).toContain("`metadata` JSON NOT NULL");
    expect(tidbHeadSql).toContain("`tenant_id` VARCHAR(255) NOT NULL");
    expect(tidbPublicationSql).not.toContain("`tenant_id` TEXT");
    expect(tidbHeadSql).not.toContain("`tenant_id` TEXT");
    const postgresMigration = renderMigrationSql("postgres").join("\n");
    const tidbMigration = renderMigrationSql("tidb").join("\n");

    expect(
      postgresMigration.indexOf(
        'CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publications_space_id_uq"',
      ),
    ).toBeLessThan(
      postgresMigration.indexOf('CREATE TABLE IF NOT EXISTS "projection_set_publication_heads"'),
    );
    expect(
      tidbMigration.indexOf(
        "CREATE UNIQUE INDEX IF NOT EXISTS `projection_set_publications_space_id_uq`",
      ),
    ).toBeLessThan(
      tidbMigration.indexOf("CREATE TABLE IF NOT EXISTS `projection_set_publication_heads`"),
    );
  });

  it("binds publication members to immutable component generations", () => {
    const schema = getDatabaseSchema();
    const memberTable = findTable(schema, "projection_set_publication_members");

    expect(memberTable.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "publication_id",
      "component_type",
      "component_key",
      "generation_id",
      "document_asset_id",
      "created_at",
    ]);
    expect(renderCreateTableSql("postgres", memberTable)).toContain(
      '"component_key" UUID NOT NULL',
    );
    expect(renderCreateTableSql("tidb", memberTable)).toContain(
      "`component_key` CHAR(36) NOT NULL",
    );
    expect(renderCreateTableSql("postgres", memberTable)).toContain('"document_asset_id" UUID,');
    expect(findIndex(schema, "projection_set_publication_members_component_uq")).toMatchObject({
      columns: ["publication_id", "component_type", "component_key"],
      unique: true,
    });
    expect(findIndex(schema, "projection_set_publication_members_generation_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "generation_id",
      "publication_id",
      "component_type",
      "component_key",
    ]);
    expect(findIndex(schema, "projection_set_publication_members_document_idx").columns).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "publication_id",
      "document_asset_id",
      "component_type",
      "component_key",
    ]);
  });

  it("declares durable compilation attempts and transactional outbox dispatch state", () => {
    const schema = getDatabaseSchema();
    const attemptTable = findTable(schema, "document_compilation_attempts");
    const outboxTable = findTable(schema, "document_compilation_outbox");

    expect(attemptTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "document_asset_id",
      "document_version",
      "publication_generation_id",
      "capability_grant_id",
      "requested_by_subject_id",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "access_channel",
      "embedding_profile_kind",
      "embedding_profile_revision_id",
      "embedding_profile_revision",
      "embedding_profile_snapshot_digest",
      "retrieval_profile_kind",
      "retrieval_profile_revision_id",
      "retrieval_profile_revision",
      "retrieval_profile_snapshot_digest",
      "base_head_revision",
      "candidate_publication_id",
      "candidate_fingerprint",
      "checkpoint",
      "run_state",
      "active_slot",
      "execution_attempts",
      "max_execution_attempts",
      "queue_job_id",
      "external_job_id",
      "worker_id",
      "lease_token",
      "lease_expires_at",
      "heartbeat_at",
      "retry_at",
      "last_error_code",
      "last_error_message",
      "row_version",
      "created_at",
      "updated_at",
      "started_at",
      "completed_at",
    ]);
    expect(outboxTable.columns.map((column) => column.name)).toEqual([
      "id",
      "attempt_id",
      "event_type",
      "schema_version",
      "payload",
      "idempotency_key",
      "status",
      "dispatch_attempts",
      "available_at",
      "locked_by",
      "lock_token",
      "locked_until",
      "queue_job_id",
      "external_job_id",
      "delivered_at",
      "last_error",
      "created_at",
      "updated_at",
    ]);

    const postgresAttemptSql = renderCreateTableSql("postgres", attemptTable);
    const tidbAttemptSql = renderCreateTableSql("tidb", attemptTable);
    const postgresOutboxSql = renderCreateTableSql("postgres", outboxTable);
    const tidbOutboxSql = renderCreateTableSql("tidb", outboxTable);

    expect(postgresAttemptSql).toContain('"publication_generation_id" UUID NOT NULL');
    expect(postgresAttemptSql).toContain('"lease_token" UUID');
    expect(tidbAttemptSql).toContain("`lease_token` CHAR(36)");
    expect(postgresAttemptSql).toContain('"last_error_code" VARCHAR(64)');
    expect(postgresAttemptSql).not.toContain('"last_error_code" VARCHAR(128)');
    expect(postgresAttemptSql).toContain(
      'CONSTRAINT "document_compilation_attempts_generation_nonzero_ck" CHECK ("publication_generation_id" <> \'00000000-0000-0000-0000-000000000000\'::uuid)',
    );
    expect(tidbAttemptSql).toContain(
      "CONSTRAINT `document_compilation_attempts_generation_nonzero_ck` CHECK ((`publication_generation_id` REGEXP '^[0-9A-Fa-f]{8}-",
    );
    expect(postgresAttemptSql).toContain(
      'CONSTRAINT "document_compilation_attempts_active_slot_ck" CHECK ("active_slot" IS NULL OR "active_slot" = 1)',
    );
    expect(tidbAttemptSql).toContain(
      "CONSTRAINT `document_compilation_attempts_active_slot_ck` CHECK (`active_slot` IS NULL OR `active_slot` = 1)",
    );
    expect(renderCreateTableSql("postgres", findTable(schema, "knowledge_spaces"))).toContain(
      'CONSTRAINT "knowledge_spaces_tenant_id_length_ck" CHECK (CHAR_LENGTH("tenant_id") <= 255)',
    );
    expect(attemptTable.checkConstraints?.map((constraint) => constraint.name)).toEqual([
      "document_compilation_attempts_generation_nonzero_ck",
      "document_compilation_attempts_authorization_binding_ck",
      "document_compilation_attempts_embedding_profile_ck",
      "document_compilation_attempts_retrieval_profile_ck",
      "document_compilation_attempts_profile_tuple_ck",
      "document_compilation_attempts_active_slot_ck",
      "document_compilation_attempts_document_version_ck",
      "document_compilation_attempts_base_revision_ck",
      "document_compilation_attempts_execution_count_ck",
      "document_compilation_attempts_row_version_ck",
      "document_compilation_attempts_checkpoint_ck",
      "document_compilation_attempts_run_state_ck",
      "document_compilation_attempts_lifecycle_ck",
      "document_compilation_attempts_retry_schedule_ck",
      "document_compilation_attempts_candidate_pair_ck",
      "document_compilation_attempts_candidate_checkpoint_ck",
      "document_compilation_attempts_lease_state_ck",
      "document_compilation_attempts_lease_token_ck",
    ]);
    expect(attemptTable.foreignKeys).toContainEqual({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "permission_snapshot_id",
        "requested_by_subject_id",
        "access_channel",
      ],
      onDelete: "RESTRICT",
      referencedColumns: ["tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"],
      referencedTable: "knowledge_space_permission_snapshots",
    });
    expect(postgresAttemptSql).toContain('CHECK ("document_version" > 0)');
    expect(tidbAttemptSql).not.toContain(
      "CONSTRAINT `document_compilation_attempts_document_version_ck`",
    );
    expect(tidbAttemptSql).not.toContain(
      "CONSTRAINT `document_compilation_attempts_candidate_pair_ck`",
    );
    expect(tidbAttemptSql).not.toContain(
      "CONSTRAINT `document_compilation_attempts_candidate_checkpoint_ck`",
    );
    expect(postgresAttemptSql).toContain('CHECK ("base_head_revision" >= 0)');
    expect(postgresAttemptSql).toContain(
      'CHECK ("execution_attempts" >= 0 AND "max_execution_attempts" > 0 AND "execution_attempts" <= "max_execution_attempts")',
    );
    expect(postgresAttemptSql).toContain('CHECK ("row_version" >= 0)');
    expect(postgresAttemptSql).toContain(
      "\"checkpoint\" IN ('queued', 'parsed', 'outline_built', 'nodes_generated', 'projection_built', 'smoke_eval_passed', 'published')",
    );
    expect(postgresAttemptSql).toContain(
      "\"run_state\" IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled', 'superseded')",
    );
    expect(postgresAttemptSql).not.toContain("pending_dispatch");
    expect(postgresAttemptSql).toContain('"active_slot" IS NULL AND "completed_at" IS NOT NULL');
    expect(postgresAttemptSql).toContain('"active_slot" = 1 AND "completed_at" IS NULL');
    expect(postgresAttemptSql).toContain('"run_state" = \'retry_wait\' AND "retry_at" IS NOT NULL');
    expect(postgresAttemptSql).toContain('"run_state" <> \'retry_wait\' AND "retry_at" IS NULL');
    expect(postgresAttemptSql).toContain(
      '"candidate_publication_id" IS NULL AND "candidate_fingerprint" IS NULL',
    );
    expect(postgresAttemptSql).toContain(
      '"candidate_publication_id" IS NOT NULL AND "candidate_fingerprint" IS NOT NULL',
    );
    expect(postgresAttemptSql).toContain(
      "\"checkpoint\" NOT IN ('projection_built', 'smoke_eval_passed', 'published') OR (\"candidate_publication_id\" IS NOT NULL AND \"candidate_fingerprint\" IS NOT NULL)",
    );
    expect(postgresAttemptSql).toContain(
      '"run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL',
    );
    expect(postgresAttemptSql).toContain(
      '"run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL',
    );
    expect(tidbAttemptSql).toContain(
      "`lease_token` IS NULL OR (`lease_token` REGEXP '^[0-9A-Fa-f]{8}-",
    );
    expect(postgresOutboxSql).toContain('"payload" JSONB NOT NULL');
    expect(tidbOutboxSql).toContain("`payload` JSON NOT NULL");
    expect(postgresOutboxSql).toContain('"lock_token" UUID');
    expect(tidbOutboxSql).toContain("`lock_token` CHAR(36)");
    expect(outboxTable.checkConstraints?.map((constraint) => constraint.name)).toEqual([
      "document_compilation_outbox_event_type_ck",
      "document_compilation_outbox_schema_version_ck",
      "document_compilation_outbox_status_ck",
      "document_compilation_outbox_dispatch_attempts_ck",
      "document_compilation_outbox_lock_state_ck",
      "document_compilation_outbox_lock_token_ck",
    ]);
    expect(postgresOutboxSql).toContain("CHECK (\"event_type\" = 'document.compile')");
    expect(postgresOutboxSql).toContain('CHECK ("schema_version" = 1)');
    expect(postgresOutboxSql).toContain(
      "\"status\" IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')",
    );
    expect(postgresOutboxSql).toContain('CHECK ("dispatch_attempts" >= 0)');
    expect(postgresOutboxSql).toContain(
      '"status" = \'dispatching\' AND "locked_by" IS NOT NULL AND "lock_token" IS NOT NULL AND "locked_until" IS NOT NULL',
    );
    expect(postgresOutboxSql).toContain(
      '"status" <> \'dispatching\' AND "locked_by" IS NULL AND "lock_token" IS NULL AND "locked_until" IS NULL',
    );
    expect(tidbOutboxSql).toContain(
      "`lock_token` IS NULL OR (`lock_token` REGEXP '^[0-9A-Fa-f]{8}-",
    );

    expect(
      findIndex(schema, "document_compilation_attempts_scope_version_active_uq"),
    ).toMatchObject({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "document_asset_id",
        "document_version",
        "active_slot",
      ],
      unique: true,
    });
    expect(findIndex(schema, "document_compilation_outbox_attempt_event_uq")).toMatchObject({
      columns: ["attempt_id", "event_type"],
      unique: true,
    });
    expect(findIndex(schema, "document_compilation_outbox_idempotency_uq")).toMatchObject({
      columns: ["idempotency_key"],
      unique: true,
    });
    expect(findIndex(schema, "knowledge_spaces_tenant_id_uq")).toMatchObject({
      columns: ["tenant_id", "id"],
      unique: true,
    });
    expect(findIndex(schema, "document_assets_space_id_version_uq")).toMatchObject({
      columns: ["knowledge_space_id", "id", "version"],
      unique: true,
    });
    expect(findIndex(schema, "projection_set_publications_space_id_fingerprint_uq")).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
      unique: true,
    });
    expect(findIndex(schema, "document_compilation_attempts_document_version_idx")).toMatchObject({
      columns: ["knowledge_space_id", "document_asset_id", "document_version", "id"],
    });
    expect(findIndex(schema, "document_compilation_attempts_candidate_idx")).toMatchObject({
      columns: [
        "tenant_id",
        "knowledge_space_id",
        "candidate_publication_id",
        "candidate_fingerprint",
        "id",
      ],
    });
  });

  it("allows derived rows from different publication generations to coexist", () => {
    const schema = getDatabaseSchema();
    const componentTables = [
      "index_projections",
      "document_outlines",
      "document_multimodal_manifests",
      "knowledge_paths",
      "graph_entities",
      "graph_relations",
    ];

    for (const tableName of componentTables) {
      const generationColumn = findTable(schema, tableName).columns.find(
        (column) => column.name === "publication_generation_id",
      );

      expect(generationColumn, tableName).toMatchObject({
        nullable: true,
        type: { postgres: "UUID", tidb: "CHAR(36)" },
      });
    }

    const generationAwareIndexes = [
      "index_projections_node_type_version_model_uq",
      "document_outlines_asset_version_uq",
      "document_multimodal_manifests_asset_version_uq",
      "knowledge_paths_space_path_uq",
      "graph_entities_space_key_uq",
      "graph_relations_space_edge_version_uq",
    ];
    for (const indexName of generationAwareIndexes) {
      const index = findIndex(schema, indexName);
      const postgresSql = renderCreateIndexSql("postgres", index);
      const tidbSql = renderCreateIndexSql("tidb", index);

      expect(index.unique, indexName).toBe(true);
      expect(index.columns, indexName).toContain("publication_generation_id");
      expect(postgresSql, indexName).toContain(
        `COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid)`,
      );
      expect(tidbSql, indexName).toContain("`publication_generation_key`");
      expect(tidbSql, indexName).not.toContain("CAST(COALESCE");
    }
  });

  it("validates TiDB publication UUIDs and reserves zero for legacy NULL sentinels", () => {
    const schema = getDatabaseSchema();
    const tidbUuidPattern =
      "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$";
    const nullableGenerationChecks = {
      document_multimodal_manifests: "document_multimodal_pub_gen_nonzero_ck",
      document_outlines: "document_outlines_pub_gen_nonzero_ck",
      graph_entities: "graph_entities_pub_gen_nonzero_ck",
      graph_relations: "graph_relations_pub_gen_nonzero_ck",
      index_projections: "index_projections_pub_gen_nonzero_ck",
      knowledge_paths: "knowledge_paths_pub_gen_nonzero_ck",
    } as const;

    for (const [tableName, constraintName] of Object.entries(nullableGenerationChecks)) {
      const table = findTable(schema, tableName);
      const constraint = table.checkConstraints?.find(
        (candidate) => candidate.name === constraintName,
      );

      expect(constraint, tableName).toEqual({
        expression: {
          postgres:
            '"publication_generation_id" IS NULL OR "publication_generation_id" <> \'00000000-0000-0000-0000-000000000000\'::uuid',
          tidb: `\`publication_generation_id\` IS NULL OR (\`publication_generation_id\` REGEXP '${tidbUuidPattern}' AND \`publication_generation_id\` <> '00000000-0000-0000-0000-000000000000')`,
        },
        name: constraintName,
      });
      expect(renderCreateTableSql("postgres", table), tableName).toContain(
        `CONSTRAINT "${constraintName}" CHECK (`,
      );
      expect(renderCreateTableSql("tidb", table), tableName).toContain(
        `CONSTRAINT \`${constraintName}\` CHECK (`,
      );
    }

    const memberTable = findTable(schema, "projection_set_publication_members");
    expect(memberTable.checkConstraints).toEqual([
      {
        expression: {
          postgres: "\"generation_id\" <> '00000000-0000-0000-0000-000000000000'::uuid",
          tidb: `(\`generation_id\` REGEXP '${tidbUuidPattern}' AND \`generation_id\` <> '00000000-0000-0000-0000-000000000000')`,
        },
        name: "publication_members_gen_nonzero_ck",
      },
    ]);
  });

  it("declares graph entity and relation storage for traversal queries", () => {
    const schema = getDatabaseSchema();
    const entityTable = findTable(schema, "graph_entities");
    const relationTable = findTable(schema, "graph_relations");

    expect(
      entityTable.columns.filter((column) => !column.dialects).map((column) => column.name),
    ).toEqual([
      "id",
      "knowledge_space_id",
      "publication_generation_id",
      "canonical_key",
      "type",
      "name",
      "aliases",
      "confidence",
      "source_node_ids",
      "permission_scope",
      "metadata",
      "extraction_version",
      "created_at",
      "updated_at",
    ]);
    expect(
      relationTable.columns.filter((column) => !column.dialects).map((column) => column.name),
    ).toEqual([
      "id",
      "knowledge_space_id",
      "publication_generation_id",
      "subject_entity_id",
      "object_entity_id",
      "type",
      "confidence",
      "source_node_ids",
      "permission_scope",
      "metadata",
      "extraction_version",
      "created_at",
      "updated_at",
    ]);
    expect(findIndex(schema, "graph_entities_space_key_uq").unique).toBe(true);
    expect(renderCreateTableSql("postgres", entityTable)).toContain('"aliases" JSONB NOT NULL');
    expect(renderCreateTableSql("tidb", relationTable)).toContain(
      "`permission_scope` JSON NOT NULL",
    );
  });

  it("declares ResourceMount storage for mounted filesystem resources", () => {
    const schema = getDatabaseSchema();
    const mountTable = findTable(schema, "resource_mounts");

    expect(mountTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "mount_path",
      "resource_type",
      "provider",
      "mode",
      "capabilities",
      "source_pointer",
      "permission_scope",
      "permission_snapshot_version",
      "freshness_policy",
      "cache_policy",
      "metadata",
      "created_at",
      "last_synced_at",
    ]);
    expect(renderCreateTableSql("postgres", mountTable)).toContain('"capabilities" JSONB NOT NULL');
    expect(renderCreateTableSql("tidb", mountTable)).toContain("`cache_policy` JSON NOT NULL");
  });

  it("declares KnowledgeSpace manifest storage for control-plane policies", () => {
    const schema = getDatabaseSchema();
    const manifestTable = findTable(schema, "knowledge_space_manifests");

    expect(manifestTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "manifest_version",
      "storage_provider",
      "object_key_prefix",
      "metadata_dialect",
      "parser_policy_version",
      "node_schema_version",
      "projection_set_version",
      "min_client_version",
      "retention_policy",
      "quota_policy",
      "consistency_policy",
      "encryption_policy",
      "metadata",
      "created_at",
      "updated_at",
    ]);
    expect(renderCreateTableSql("postgres", manifestTable)).toContain(
      '"retention_policy" JSONB NOT NULL',
    );
    expect(renderCreateTableSql("tidb", manifestTable)).toContain(
      "`consistency_policy` JSON NOT NULL",
    );
  });

  it("declares staged commit ledger storage for recoverable ingestion state", () => {
    const schema = getDatabaseSchema();
    const commitTable = findTable(schema, "knowledge_space_staged_commits");

    expect(commitTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "operation_type",
      "idempotency_key",
      "status",
      "raw_object_key",
      "published_object_key",
      "document_asset_id",
      "parse_artifact_id",
      "projection_fingerprint",
      "checksum",
      "size_bytes",
      "error_code",
      "error_message",
      "created_at",
      "updated_at",
      "expires_at",
    ]);
    expect(renderCreateTableSql("postgres", commitTable)).toContain(
      '"idempotency_key" VARCHAR(255) NOT NULL',
    );
    expect(renderCreateTableSql("tidb", commitTable)).toContain("`error_message` TEXT");
  });

  it("declares KnowledgeFS session storage for active runtime clients", () => {
    const schema = getDatabaseSchema();
    const sessionTable = findTable(schema, "knowledge_fs_sessions");

    expect(sessionTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "client_kind",
      "client_version",
      "subject",
      "permission_snapshot",
      "consistency_class",
      "heartbeat_at",
      "expires_at",
      "metadata",
      "created_at",
      "updated_at",
    ]);
    expect(renderCreateTableSql("postgres", sessionTable)).toContain(
      '"permission_snapshot" JSONB NOT NULL',
    );
    expect(renderCreateTableSql("tidb", sessionTable)).toContain("`subject` JSON NOT NULL");
  });

  it("declares KnowledgeFS lease storage for active runtime operations", () => {
    const schema = getDatabaseSchema();
    const leaseTable = findTable(schema, "knowledge_fs_leases");

    expect(leaseTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "session_id",
      "lease_type",
      "target_type",
      "target_id",
      "target_version",
      "virtual_path",
      "status",
      "heartbeat_at",
      "expires_at",
      "metadata",
      "acquired_at",
      "updated_at",
    ]);
    expect(renderCreateTableSql("postgres", leaseTable)).toContain('"target_version" INTEGER,');
    expect(renderCreateTableSql("tidb", leaseTable)).toContain("`metadata` JSON NOT NULL");
  });

  it("declares artifact segment storage for bounded parser output", () => {
    const schema = getDatabaseSchema();
    const segmentTable = findTable(schema, "artifact_segments");

    expect(segmentTable.columns.map((column) => column.name)).toEqual([
      "id",
      "knowledge_space_id",
      "document_asset_id",
      "parse_artifact_id",
      "segment_index",
      "segment_type",
      "artifact_hash",
      "checksum",
      "object_key",
      "inline_text",
      "content_encoding",
      "size_bytes",
      "start_offset",
      "end_offset",
      "source_location",
      "metadata",
      "created_at",
      "updated_at",
    ]);
    expect(renderCreateTableSql("postgres", segmentTable)).toContain(
      '"source_location" JSONB NOT NULL',
    );
    expect(renderCreateTableSql("tidb", segmentTable)).toContain("`inline_text` TEXT");
  });

  it("declares KnowledgeFS physical view path fields", () => {
    const schema = getDatabaseSchema();
    const pathTable = findTable(schema, "knowledge_paths");

    expect(
      pathTable.columns.filter((column) => !column.dialects).map((column) => column.name),
    ).toEqual([
      "id",
      "knowledge_space_id",
      "publication_generation_id",
      "virtual_path",
      "resource_type",
      "target_id",
      "version",
      "view_type",
      "view_name",
      "metadata",
      "updated_at",
    ]);
    expect(renderCreateTableSql("postgres", pathTable)).toContain(
      '"view_type" VARCHAR(16) NOT NULL',
    );
    expect(renderCreateTableSql("tidb", pathTable)).toContain("`metadata` JSON NOT NULL");
  });

  it("declares golden question storage for Phase 1 evaluation", () => {
    const schema = getDatabaseSchema();
    const goldenTable = findTable(schema, "golden_questions");

    expect(goldenTable.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "knowledge_space_id",
      "question",
      "expected_evidence_ids",
      "tags",
      "metadata",
      "required_permission_scope",
      "created_at",
      "updated_at",
      "scope_binding_complete",
    ]);
    expect(renderCreateTableSql("postgres", goldenTable)).toContain(
      '"expected_evidence_ids" JSONB NOT NULL',
    );
    expect(renderCreateTableSql("tidb", goldenTable)).toContain("`tags` JSON NOT NULL");
    expect(renderCreateTableSql("postgres", goldenTable)).not.toContain('"scope_binding_complete"');
    expect(renderCreateTableSql("tidb", goldenTable)).toContain(
      "`scope_binding_complete` TINYINT GENERATED ALWAYS AS",
    );
    expect(goldenTable.foreignKeys).toContainEqual({
      columns: ["tenant_id", "knowledge_space_id"],
      onDelete: "CASCADE",
      referencedColumns: ["tenant_id", "id"],
      referencedTable: "knowledge_spaces",
    });
    expect(goldenTable.checkConstraints?.map((constraint) => constraint.name)).toContain(
      "golden_questions_scope_json_ck",
    );
  });

  it("declares dense vector projection storage for PostgreSQL and TiDB", () => {
    const schema = getDatabaseSchema();
    const projectionTable = findTable(schema, "index_projections");
    const logicalProjectionIndex = findIndex(
      schema,
      "index_projections_node_type_version_model_uq",
    );

    expect(renderCreateTableSql("postgres", projectionTable)).toContain('"dense_vector" vector');
    expect(renderCreateTableSql("postgres", projectionTable)).not.toContain(
      '"dense_vector" vector(',
    );
    expect(renderCreateTableSql("tidb", projectionTable)).toContain("`dense_vector` VECTOR");
    expect(renderCreateTableSql("tidb", projectionTable)).not.toContain("`dense_vector` VECTOR(");
    expect(projectionTable.columns.map((column) => column.name)).toContain("updated_at");
    expect(
      getDatabaseSchema().indexes.some((index) =>
        [
          "index_projections_dense_vector_hnsw_idx",
          "index_projections_visual_vector_hnsw_idx",
        ].includes(index.name),
      ),
    ).toBe(false);
    expect(renderMigrationSql("postgres").join("\n")).not.toContain(
      "index_projections_dense_vector_hnsw_idx",
    );
    expect(renderMigrationSql("tidb").join("\n")).not.toContain("VECTOR(1536)");
    expect(logicalProjectionIndex.unique).toBe(true);
    expect(renderCreateIndexSql("postgres", logicalProjectionIndex)).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "index_projections_node_type_version_model_uq" ON "index_projections" ("node_id", "type", "projection_version", (COALESCE("model", \'\')), (COALESCE("publication_generation_id", \'00000000-0000-0000-0000-000000000000\'::uuid)));',
    );
    expect(renderCreateIndexSql("tidb", logicalProjectionIndex)).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS `index_projections_node_type_version_model_uq` ON `index_projections` (`node_id`, `type`, `projection_version`, `model_key`, `publication_generation_key`);",
    );
  });

  it("declares database-native full-text projection storage and indexes", () => {
    const schema = getDatabaseSchema();
    const projectionTable = findTable(schema, "index_projections");
    const postingTable = findTable(schema, "index_projection_fts_postings");
    const backfillTable = findTable(schema, "tidb_fts_posting_backfills");
    const ftsIndex = findIndex(schema, "index_projections_fts_document_idx");
    const projectionSpaceId = findIndex(schema, "index_projections_space_id_uq");
    const postingLookup = findIndex(schema, "index_projection_fts_postings_lookup_idx");

    expect(renderCreateTableSql("postgres", projectionTable)).toContain('"fts_document" tsvector');
    expect(renderCreateTableSql("tidb", projectionTable)).toContain("`fts_document` TEXT");
    expect(renderCreateIndexSql("postgres", ftsIndex)).toBe(
      'CREATE INDEX IF NOT EXISTS "index_projections_fts_document_idx" ON "index_projections" USING GIN ("fts_document");',
    );
    expect(() => renderCreateIndexSql("tidb", ftsIndex)).toThrow(
      "Index index_projections_fts_document_idx is not available for tidb",
    );
    expect(renderCreateTableSql("tidb", postingTable)).toContain("`term_hash` CHAR(64) NOT NULL");
    expect(renderCreateTableSql("tidb", postingTable)).toContain("`term` VARCHAR(128) NOT NULL");
    expect(renderCreateTableSql("tidb", postingTable)).toContain(
      "CONSTRAINT `index_projection_fts_postings_frequency_ck` CHECK (`term_frequency` > 0 AND `document_token_count` >= `term_frequency`)",
    );
    expect(renderCreateTableSql("tidb", postingTable)).toContain(
      "FOREIGN KEY (`knowledge_space_id`, `projection_id`) REFERENCES `index_projections` (`knowledge_space_id`, `id`) ON DELETE CASCADE",
    );
    expect(renderCreateIndexSql("tidb", projectionSpaceId)).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS `index_projections_space_id_uq` ON `index_projections` (`knowledge_space_id`, `id`);",
    );
    expect(renderCreateIndexSql("tidb", postingLookup)).toBe(
      "CREATE INDEX IF NOT EXISTS `index_projection_fts_postings_lookup_idx` ON `index_projection_fts_postings` (`knowledge_space_id`, `term_hash`, `projection_id`);",
    );
    expect(renderCreateTableSql("tidb", backfillTable)).toContain(
      "CONSTRAINT `tidb_fts_posting_backfills_lease_ck`",
    );
  });

  it("escapes dialect identifier quote characters when rendering SQL", () => {
    const table: TableDefinition = {
      columns: [{ name: 'bad"name', type: { postgres: "TEXT", tidb: "TEXT" } }],
      name: 'bad"table',
    };
    const index: IndexDefinition = {
      columns: ["bad`column"],
      name: "bad`index",
      purpose: "identifier escaping regression",
      tableName: "bad`table",
    };

    expect(renderCreateTableSql("postgres", table)).toBe(
      'CREATE TABLE IF NOT EXISTS "bad""table" ("bad""name" TEXT NOT NULL);',
    );
    expect(renderCreateIndexSql("tidb", index)).toBe(
      "CREATE INDEX IF NOT EXISTS `bad``index` ON `bad``table` (`bad``column`);",
    );
  });

  it("declares embedding model registry storage and lookup indexes", () => {
    const schema = getDatabaseSchema();
    const table = findTable(schema, "embedding_models");

    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "provider",
      "model_id",
      "version",
      "dimension",
      "metric",
      "tokenizer",
      "max_tokens",
      "status",
      "metadata",
      "created_at",
      "updated_at",
    ]);
    expect(findIndex(schema, "embedding_models_model_version_uq").columns).toEqual([
      "model_id",
      "version",
    ]);
    expect(findIndex(schema, "embedding_models_status_provider_idx").columns).toEqual([
      "status",
      "provider",
      "model_id",
      "id",
    ]);
    expect(findIndex(schema, "embedding_models_status_model_idx").columns).toEqual([
      "status",
      "model_id",
      "id",
    ]);
  });

  it("renders PostgreSQL and TiDB migrations with table definitions before indexes", () => {
    const postgresSql = renderMigrationSql("postgres");
    const tidbSql = renderMigrationSql("tidb");

    expect(postgresSql[0]).toContain('CREATE TABLE IF NOT EXISTS "knowledge_spaces"');
    expect(postgresSql.at(-1)).toContain("INDEX IF NOT EXISTS");
    expect(tidbSql[0]).toContain("CREATE TABLE IF NOT EXISTS `knowledge_spaces`");
    expect(tidbSql.at(-1)).toContain("INDEX IF NOT EXISTS");
  });

  it("renders dialect-specific column and index SQL without runtime query work", () => {
    const schema = getDatabaseSchema();
    const nodesTable = findTable(schema, "knowledge_nodes");
    const permissionIndex = findIndex(schema, "knowledge_nodes_permission_scope_idx");

    expect(renderCreateTableSql("postgres", nodesTable)).toContain('"metadata" JSONB NOT NULL');
    expect(renderCreateTableSql("tidb", nodesTable)).toContain("`metadata` JSON NOT NULL");
    expect(renderCreateIndexSql("postgres", permissionIndex)).toBe(
      'CREATE INDEX IF NOT EXISTS "knowledge_nodes_permission_scope_idx" ON "knowledge_nodes" USING GIN ("permission_scope");',
    );
    expect(() => renderCreateIndexSql("tidb", permissionIndex)).toThrow(
      "Index knowledge_nodes_permission_scope_idx is not available for tidb",
    );
  });

  it("keeps optional domain relationships nullable in database tables", () => {
    const schema = getDatabaseSchema();
    const assetTable = findTable(schema, "document_assets");
    const traceTable = findTable(schema, "answer_traces");

    expect(renderCreateTableSql("postgres", assetTable)).toContain('"source_id" UUID,');
    expect(renderCreateTableSql("postgres", traceTable)).toContain('"evidence_bundle_id" UUID,');
  });

  it("fails fast when an indexed performance requirement is removed", () => {
    const schema = getDatabaseSchema();
    const weakened = {
      ...schema,
      indexes: schema.indexes.filter(
        (index) => index.name !== "document_assets_space_status_created_idx",
      ),
    };

    expect(assertPerformanceIndexes(weakened)).toEqual({
      ok: false,
      missing: [
        {
          indexName: "document_assets_space_status_created_idx",
          purpose: "List uploads and ingestion state by space without scanning all assets",
          tableName: "document_assets",
        },
      ],
    });
  });

  it("projects a P9 final catalog with no legacy authorization tables, indexes, or foreign keys", () => {
    const schema = getP9FinalDatabaseSchema();
    const legacyTables = new Set([
      "knowledge_space_access_policies",
      "knowledge_space_access_policy_members",
      "knowledge_space_api_access",
      "knowledge_space_api_keys",
      "knowledge_space_members",
      "knowledge_space_permission_snapshots",
    ]);

    expect(schema.tables.some((table) => legacyTables.has(table.name))).toBe(false);
    expect(schema.indexes.some((index) => legacyTables.has(index.tableName))).toBe(false);
    expect(
      schema.tables.some((table) =>
        table.foreignKeys?.some((foreignKey) => legacyTables.has(foreignKey.referencedTable)),
      ),
    ).toBe(false);
  });
});

function findTable(schema: DatabaseSchemaCatalog, tableName: string): TableDefinition {
  const table = schema.tables.find((candidate) => candidate.name === tableName);

  if (!table) {
    throw new Error(`Expected table ${tableName} to be declared`);
  }

  return table;
}

function findIndex(schema: DatabaseSchemaCatalog, indexName: string): IndexDefinition {
  const index = schema.indexes.find((candidate) => candidate.name === indexName);

  if (!index) {
    throw new Error(`Expected index ${indexName} to be declared`);
  }

  return index;
}
