import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createSchemaDatabaseAdapter } from "./database";
import { runDatabaseMigrations } from "./migration-runner";

const migrationsBeforeCheckConstraints = [
  "0001_initial_schema",
  "0002_vector_index_upgrade",
  "0003_projection_set_publications",
  "0004_projection_publication_members",
] as const;
const checkConstraintMigrationId = "0005_publication_generation_nonzero";
const compilationMigrationId = "0006_document_compilation_attempts";
const knowledgeNodeGenerationMigrationId = "0007_knowledge_node_generations";
const flattenedPageIndexMigrationId = "0008_flattened_page_index";
const legacySpaceBootstrapMigrationId = "0009_legacy_space_bootstrap";
const pageIndexUpgradeBackfillMigrationId = "0010_page_index_upgrade_backfill";
const tidbFtsPostingsMigrationId = "0011_tidb_fts_postings";
const tidbBaselineRepairMigrationId = "0012_tidb_baseline_repair";
const spaceAccessControlMigrationId = "0013_space_access_control";
const sourceCredentialRefsMigrationId = "0014_source_credential_refs";
const researchTaskJobsMigrationId = "0015_research_task_jobs";
const compilationPermissionBindingMigrationId = "0016_compilation_job_requester_binding";
const durableDeletionMigrationId = "0017_durable_deletion";
const versionedSpaceProfilesMigrationId = "0018_versioned_space_profiles";
const profilePublicationBindingsMigrationId = "0019_profile_publication_bindings";
const profileMigrationRunsMigrationId = "0020_profile_migration_runs";
const sourceProductWorkflowsMigrationId = "0021_source_product_workflows";
const logicalDocumentRevisionsMigrationId = "0022_logical_document_revisions";
const knowledgeSpaceOverviewMigrationId = "0023_knowledge_space_overview";
const qualityControlMigrationId = "0024_quality_control";
const capabilityGrantProvenanceMigrationId = "0025_capability_grant_provenance";
const capabilityJobProvenanceMigrationId = "0026_capability_job_provenance";
const uploadSessionsMigrationId = "0027_upload_sessions";
const difyIntegrationStatesMigrationId = "0028_dify_integration_states";
const difyIntegrationFreezesMigrationId = "0029_dify_integration_freezes";
const bulkOperationsMigrationId = "0030_bulk_operations";
const migrationsAfterDurableDeletion = [
  versionedSpaceProfilesMigrationId,
  profilePublicationBindingsMigrationId,
  profileMigrationRunsMigrationId,
  sourceProductWorkflowsMigrationId,
  logicalDocumentRevisionsMigrationId,
  knowledgeSpaceOverviewMigrationId,
  qualityControlMigrationId,
  capabilityGrantProvenanceMigrationId,
  capabilityJobProvenanceMigrationId,
  uploadSessionsMigrationId,
  difyIntegrationStatesMigrationId,
  difyIntegrationFreezesMigrationId,
  bulkOperationsMigrationId,
] as const;
const migrationsAfterTidbBaselineRepair = [
  spaceAccessControlMigrationId,
  sourceCredentialRefsMigrationId,
  researchTaskJobsMigrationId,
  compilationPermissionBindingMigrationId,
  durableDeletionMigrationId,
  ...migrationsAfterDurableDeletion,
] as const;
const allMigrationIds = [
  ...migrationsBeforeCheckConstraints,
  checkConstraintMigrationId,
  compilationMigrationId,
  knowledgeNodeGenerationMigrationId,
  flattenedPageIndexMigrationId,
  legacySpaceBootstrapMigrationId,
  pageIndexUpgradeBackfillMigrationId,
  tidbFtsPostingsMigrationId,
  tidbBaselineRepairMigrationId,
  ...migrationsAfterTidbBaselineRepair,
] as const;

describe("runDatabaseMigrations", () => {
  it("applies pending migrations once and records schema_migrations rows", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const applied = new Set<string>();
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (isTenantLengthPreflight(input)) {
          return { rows: [], rowsAffected: 0 };
        }

        if (input.operation === "select") {
          return {
            rows: [...applied].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }

        if (input.operation === "insert") {
          applied.add(String(input.params[0]));
        }

        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      },
      kind: "postgres",
    });

    await expect(
      runDatabaseMigrations({ database, now: () => "2026-05-13T00:00:00.000Z" }),
    ).resolves.toEqual({
      appliedMigrationIds: allMigrationIds,
      pendingBeforeRun: allMigrationIds.length,
    });
    await expect(
      runDatabaseMigrations({ database, now: () => "2026-05-13T00:00:00.000Z" }),
    ).resolves.toEqual({
      appliedMigrationIds: [],
      pendingBeforeRun: 0,
    });

    expect(calls.map((call) => call.operation)).toEqual([
      "schema",
      "select",
      ...allMigrationIds.flatMap((migrationId) => [
        ...(migrationId === compilationMigrationId ? (["select"] as const) : []),
        "schema" as const,
        "insert" as const,
      ]),
      "schema",
      "select",
    ]);
    expect(calls[1]).toMatchObject({
      maxRows: 10_000,
      operation: "select",
      params: ["postgres"],
      tableName: "schema_migrations",
    });
    expect(calls[2]?.sql).toContain("-- Migration id: 0001_initial_schema");
    expect(calls[3]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: ["0001_initial_schema", "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[4]?.sql).toContain("-- Migration id: 0002_vector_index_upgrade");
    expect(calls[5]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: ["0002_vector_index_upgrade", "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[6]?.sql).toContain("-- Migration id: 0003_projection_set_publications");
    expect(calls[7]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: ["0003_projection_set_publications", "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[8]?.sql).toContain("-- Migration id: 0004_projection_publication_members");
    expect(calls[9]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: ["0004_projection_publication_members", "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[10]?.sql).toContain("-- Migration id: 0005_publication_generation_nonzero");
    expect(calls[11]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: ["0005_publication_generation_nonzero", "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[12]).toMatchObject({
      maxRows: 1,
      operation: "select",
      params: [],
      tableName: "knowledge_spaces",
    });
    expect(calls[13]?.sql).toContain("-- Migration id: 0006_document_compilation_attempts");
    expect(calls[14]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [compilationMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[15]?.sql).toContain("-- Migration id: 0007_knowledge_node_generations");
    expect(calls[16]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [knowledgeNodeGenerationMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[17]?.sql).toContain("-- Migration id: 0008_flattened_page_index");
    expect(calls[18]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [flattenedPageIndexMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[19]?.sql).toContain("-- Migration id: 0009_legacy_space_bootstrap");
    expect(calls[20]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [legacySpaceBootstrapMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[21]?.sql).toContain("-- Migration id: 0010_page_index_upgrade_backfill");
    expect(calls[22]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [pageIndexUpgradeBackfillMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[23]?.sql).toContain("-- Migration id: 0011_tidb_fts_postings");
    expect(calls[24]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [tidbFtsPostingsMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[25]?.sql).toContain("-- Migration id: 0012_tidb_baseline_repair");
    expect(calls[26]).toMatchObject({
      maxRows: 0,
      operation: "insert",
      params: [tidbBaselineRepairMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
      tableName: "schema_migrations",
    });
    expect(calls[27]?.sql).toContain("-- Migration id: 0013_space_access_control");
    expect(calls[28]).toMatchObject({
      operation: "insert",
      params: [spaceAccessControlMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
    });
    expect(calls[29]?.sql).toContain("-- Migration id: 0014_source_credential_refs");
    expect(calls[30]).toMatchObject({
      operation: "insert",
      params: [sourceCredentialRefsMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
    });
    expect(calls[31]?.sql).toContain("-- Migration id: 0015_research_task_jobs");
    expect(calls[32]).toMatchObject({
      operation: "insert",
      params: [researchTaskJobsMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
    });
    expect(calls[33]?.sql).toContain("-- Migration id: 0016_compilation_job_requester_binding");
    expect(calls[34]).toMatchObject({
      operation: "insert",
      params: [compilationPermissionBindingMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
    });
    expect(calls[35]?.sql).toContain("-- Migration id: 0017_durable_deletion");
    expect(calls[36]).toMatchObject({
      operation: "insert",
      params: [durableDeletionMigrationId, "postgres", "2026-05-13T00:00:00.000Z"],
    });
    const migrationDdlCalls = calls.filter(
      (call) => call.operation === "schema" && call.sql.includes("-- Migration id:"),
    );
    const migrationMarkerCalls = calls.filter((call) => call.operation === "insert");
    expect(
      migrationDdlCalls.map((call) => /-- Migration id: ([^\s]+)/u.exec(call.sql)?.[1]),
    ).toEqual(allMigrationIds);
    expect(migrationMarkerCalls.map((call) => call.params[0])).toEqual(allMigrationIds);
    for (const [index, migrationId] of allMigrationIds.entries()) {
      expect(migrationDdlCalls[index]?.sql).toContain(`-- Migration id: ${migrationId}`);
      expect(migrationMarkerCalls[index]?.params).toEqual([
        migrationId,
        "postgres",
        "2026-05-13T00:00:00.000Z",
      ]);
    }
  });

  it("replays migration 0015 when its DDL committed before the marker insert", async () => {
    const applied = new Set<string>([
      ...migrationsBeforeCheckConstraints,
      checkConstraintMigrationId,
      compilationMigrationId,
      knowledgeNodeGenerationMigrationId,
      flattenedPageIndexMigrationId,
      legacySpaceBootstrapMigrationId,
      pageIndexUpgradeBackfillMigrationId,
      tidbFtsPostingsMigrationId,
      tidbBaselineRepairMigrationId,
      spaceAccessControlMigrationId,
      sourceCredentialRefsMigrationId,
      compilationPermissionBindingMigrationId,
      durableDeletionMigrationId,
      ...migrationsAfterDurableDeletion,
    ]);
    let artifactExecutions = 0;
    let markerAttempts = 0;
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        if (input.operation === "select") {
          return {
            rows: [...applied].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }
        if (
          input.operation === "schema" &&
          input.sql.includes(`-- Migration id: ${researchTaskJobsMigrationId}`)
        ) {
          artifactExecutions += 1;
        }
        if (input.operation === "insert" && input.params[0] === researchTaskJobsMigrationId) {
          markerAttempts += 1;
          if (markerAttempts === 1) {
            throw new Error("simulated process exit before migration marker");
          }
          applied.add(researchTaskJobsMigrationId);
        }
        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      },
      kind: "postgres",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "simulated process exit before migration marker",
    );
    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [researchTaskJobsMigrationId],
      pendingBeforeRun: 1,
    });
    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [],
      pendingBeforeRun: 0,
    });
    expect(artifactExecutions).toBe(2);
    expect(markerAttempts).toBe(2);
  });

  it("replays migration 0016 when its DDL committed before the marker insert", async () => {
    const applied = new Set<string>([
      ...migrationsBeforeCheckConstraints,
      checkConstraintMigrationId,
      compilationMigrationId,
      knowledgeNodeGenerationMigrationId,
      flattenedPageIndexMigrationId,
      legacySpaceBootstrapMigrationId,
      pageIndexUpgradeBackfillMigrationId,
      tidbFtsPostingsMigrationId,
      tidbBaselineRepairMigrationId,
      spaceAccessControlMigrationId,
      sourceCredentialRefsMigrationId,
      researchTaskJobsMigrationId,
      durableDeletionMigrationId,
      ...migrationsAfterDurableDeletion,
    ]);
    let artifactExecutions = 0;
    let markerAttempts = 0;
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        if (input.operation === "select") {
          return {
            rows: [...applied].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }
        if (
          input.operation === "schema" &&
          input.sql.includes(`-- Migration id: ${compilationPermissionBindingMigrationId}`)
        ) {
          artifactExecutions += 1;
        }
        if (
          input.operation === "insert" &&
          input.params[0] === compilationPermissionBindingMigrationId
        ) {
          markerAttempts += 1;
          if (markerAttempts === 1) {
            throw new Error("simulated process exit before migration marker");
          }
          applied.add(compilationPermissionBindingMigrationId);
        }
        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      },
      kind: "postgres",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "simulated process exit before migration marker",
    );
    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [compilationPermissionBindingMigrationId],
      pendingBeforeRun: 1,
    });
    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [],
      pendingBeforeRun: 0,
    });
    expect(artifactExecutions).toBe(2);
    expect(markerAttempts).toBe(2);
  });

  it("replays migration 0017 when its DDL committed before the marker insert", async () => {
    const applied = new Set<string>([
      ...migrationsBeforeCheckConstraints,
      checkConstraintMigrationId,
      compilationMigrationId,
      knowledgeNodeGenerationMigrationId,
      flattenedPageIndexMigrationId,
      legacySpaceBootstrapMigrationId,
      pageIndexUpgradeBackfillMigrationId,
      tidbFtsPostingsMigrationId,
      tidbBaselineRepairMigrationId,
      spaceAccessControlMigrationId,
      sourceCredentialRefsMigrationId,
      researchTaskJobsMigrationId,
      compilationPermissionBindingMigrationId,
      ...migrationsAfterDurableDeletion,
    ]);
    let artifactExecutions = 0;
    let markerAttempts = 0;
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        if (input.operation === "select") {
          return {
            rows: [...applied].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }
        if (
          input.operation === "schema" &&
          input.sql.includes(`-- Migration id: ${durableDeletionMigrationId}`)
        ) {
          artifactExecutions += 1;
        }
        if (input.operation === "insert" && input.params[0] === durableDeletionMigrationId) {
          markerAttempts += 1;
          if (markerAttempts === 1) {
            throw new Error("simulated process exit before migration marker");
          }
          applied.add(durableDeletionMigrationId);
        }
        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      },
      kind: "postgres",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "simulated process exit before migration marker",
    );
    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [durableDeletionMigrationId],
      pendingBeforeRun: 1,
    });
    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [],
      pendingBeforeRun: 0,
    });
    expect(artifactExecutions).toBe(2);
    expect(markerAttempts).toBe(2);
  });

  it("rejects migration 0006 before narrowing an oversized historical tenant id", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (isTenantLengthPreflight(input)) {
          return { rows: [{ tenant_id: "t".repeat(256) }], rowsAffected: 0 };
        }

        if (input.operation === "select") {
          return {
            rows: [...migrationsBeforeCheckConstraints, checkConstraintMigrationId].map(
              (migration_id) => ({ migration_id }),
            ),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "postgres",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "cannot narrow knowledge_spaces.tenant_id to VARCHAR(255)",
    );
    expect(calls.some((call) => call.sql.includes(`Migration id: ${compilationMigrationId}`))).toBe(
      false,
    );
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("does not record a migration when applying its SQL fails", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input): Promise<DatabaseExecuteResult> => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "ON",
                foreign_key_checks_enabled: "ON",
                foreign_key_enabled: "ON",
                tidb_version: "5.7.25-TiDB-v8.5.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }

        if (input.operation === "schema" && input.sql.includes("-- Migration id:")) {
          throw new Error("ddl failed");
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow("ddl failed");
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(calls.find((call) => call.operation === "select")).toMatchObject({
      maxRows: 10_000,
      params: ["tidb"],
      tableName: "schema_migrations",
    });
  });

  it("rejects TiDB older than 7.2 before executing migration 0005 DDL", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "ON",
                tidb_version: "5.7.25-TiDB-v7.1.9",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select") {
          return {
            rows: migrationsBeforeCheckConstraints.map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow("requires TiDB 7.2 or newer");
    expect(
      calls.some((call) => call.sql.includes(`Migration id: ${checkConstraintMigrationId}`)),
    ).toBe(false);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects TiDB with CHECK constraint enforcement disabled before migration 0005 DDL", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "OFF",
                tidb_version: "5.7.25-TiDB-v7.5.1",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select") {
          return {
            rows: migrationsBeforeCheckConstraints.map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "requires @@tidb_enable_check_constraint to be ON/1",
    );
    expect(
      calls.some((call) => call.sql.includes(`Migration id: ${checkConstraintMigrationId}`)),
    ).toBe(false);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects TiDB before 8.5 when migration 0006 requires GA foreign keys", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "ON",
                foreign_key_checks_enabled: "ON",
                foreign_key_enabled: "ON",
                tidb_version: "5.7.25-TiDB-v8.4.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select") {
          return {
            rows: [...migrationsBeforeCheckConstraints, checkConstraintMigrationId].map(
              (migration_id) => ({ migration_id }),
            ),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "requires TiDB 8.5 or newer for generally available foreign-key enforcement",
    );
    expect(calls.some((call) => call.sql.includes(`Migration id: ${compilationMigrationId}`))).toBe(
      false,
    );
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects TiDB with global foreign-key support disabled before migration 0006 DDL", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: true,
                foreign_key_checks_enabled: true,
                foreign_key_enabled: false,
                tidb_version: "5.7.25-TiDB-v8.5.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select") {
          return {
            rows: [...migrationsBeforeCheckConstraints, checkConstraintMigrationId].map(
              (migration_id) => ({ migration_id }),
            ),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "requires @@GLOBAL.tidb_enable_foreign_key to be ON/1",
    );
    expect(calls.some((call) => call.sql.includes(`Migration id: ${compilationMigrationId}`))).toBe(
      false,
    );
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects TiDB with session foreign-key checks disabled before migration 0006 DDL", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "ON",
                foreign_key_checks_enabled: "OFF",
                foreign_key_enabled: "ON",
                tidb_version: "5.7.25-TiDB-v8.5.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select") {
          return {
            rows: [...migrationsBeforeCheckConstraints, checkConstraintMigrationId].map(
              (migration_id) => ({ migration_id }),
            ),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "requires @@SESSION.foreign_key_checks to be ON/1",
    );
    expect(calls.some((call) => call.sql.includes(`Migration id: ${compilationMigrationId}`))).toBe(
      false,
    );
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("applies migrations 0005 through the latest migration after TiDB constraint preflights", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const applied = new Set<string>(migrationsBeforeCheckConstraints);
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: 1,
                foreign_key_checks_enabled: 1,
                foreign_key_enabled: 1,
                tidb_version: "5.7.25-TiDB-v8.5.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select" && input.sql.includes("SHOW CREATE TABLE")) {
          return showCreateTableResult(input.tableName);
        }

        if (isTenantLengthPreflight(input)) {
          return { rows: [], rowsAffected: 0 };
        }

        if (input.operation === "select") {
          return {
            rows: [...applied].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }

        if (input.operation === "insert") {
          applied.add(String(input.params[0]));
        }

        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [
        checkConstraintMigrationId,
        compilationMigrationId,
        knowledgeNodeGenerationMigrationId,
        flattenedPageIndexMigrationId,
        legacySpaceBootstrapMigrationId,
        pageIndexUpgradeBackfillMigrationId,
        tidbFtsPostingsMigrationId,
        tidbBaselineRepairMigrationId,
        ...migrationsAfterTidbBaselineRepair,
      ],
      pendingBeforeRun: allMigrationIds.length - migrationsBeforeCheckConstraints.length,
    });
    expect(calls.find((call) => call.sql.includes("VERSION()"))).toMatchObject({
      maxRows: 1,
      operation: "select",
      params: [],
      tableName: "schema_migrations",
    });
    expect(
      calls.find((call) => call.sql.includes(`Migration id: ${checkConstraintMigrationId}`)),
    ).toMatchObject({ operation: "schema" });
    expect(calls.find((call) => call.operation === "insert")).toMatchObject({
      params: [checkConstraintMigrationId, "tidb", expect.any(String)],
    });
    expect(calls.filter((call) => call.sql.includes("SHOW CREATE TABLE"))).toHaveLength(2);
  });

  it("revalidates TiDB CHECK and foreign-key enforcement after migration 0006", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);

        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "ON",
                foreign_key_checks_enabled: "ON",
                foreign_key_enabled: "ON",
                tidb_version: "5.7.25-TiDB-v8.5.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select" && input.sql.includes("SHOW CREATE TABLE")) {
          return showCreateTableResult(input.tableName);
        }

        if (input.operation === "select") {
          return {
            rows: [
              ...migrationsBeforeCheckConstraints,
              checkConstraintMigrationId,
              compilationMigrationId,
              knowledgeNodeGenerationMigrationId,
              flattenedPageIndexMigrationId,
              legacySpaceBootstrapMigrationId,
              pageIndexUpgradeBackfillMigrationId,
              tidbFtsPostingsMigrationId,
              tidbBaselineRepairMigrationId,
              ...migrationsAfterTidbBaselineRepair,
            ].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).resolves.toEqual({
      appliedMigrationIds: [],
      pendingBeforeRun: 0,
    });
    expect(calls.filter((call) => call.sql.includes("VERSION()"))).toHaveLength(1);
    expect(calls.filter((call) => call.sql.includes("SHOW CREATE TABLE"))).toHaveLength(2);
  });

  it("rejects TiDB when SHOW CREATE marks an applied compilation foreign key invalid", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        if (input.operation === "select" && input.sql.includes("VERSION()")) {
          return {
            rows: [
              {
                check_constraint_enabled: "ON",
                foreign_key_checks_enabled: "ON",
                foreign_key_enabled: "ON",
                tidb_version: "5.7.25-TiDB-v8.5.0",
              },
            ],
            rowsAffected: 0,
          };
        }

        if (input.operation === "select" && input.sql.includes("SHOW CREATE TABLE")) {
          const result = showCreateTableResult(input.tableName);
          if (input.tableName === "document_compilation_attempts") {
            const createSql = result.rows[0]?.["Create Table"];
            return {
              ...result,
              rows: [
                {
                  "Create Table": `${String(createSql)} /* FOREIGN KEY INVALID */`,
                },
              ],
            };
          }
          return result;
        }

        if (input.operation === "select") {
          return {
            rows: [
              ...migrationsBeforeCheckConstraints,
              checkConstraintMigrationId,
              compilationMigrationId,
              knowledgeNodeGenerationMigrationId,
              flattenedPageIndexMigrationId,
              legacySpaceBootstrapMigrationId,
              pageIndexUpgradeBackfillMigrationId,
              tidbFtsPostingsMigrationId,
              tidbBaselineRepairMigrationId,
              ...migrationsAfterTidbBaselineRepair,
            ].map((migration_id) => ({ migration_id })),
            rowsAffected: 0,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
      kind: "tidb",
    });

    await expect(runDatabaseMigrations({ database })).rejects.toThrow(
      "requires 3 valid FOREIGN KEY constraints on document_compilation_attempts",
    );
  });

  it("rejects invalid migration record limits before touching the database", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });

    for (const maxMigrationRecords of [0, 1.5]) {
      await expect(runDatabaseMigrations({ database, maxMigrationRecords })).rejects.toThrow(
        "Migration runner maxMigrationRecords must be at least 1",
      );
    }
  });

  it("rejects invalid rows returned from schema_migrations", async () => {
    for (const migration_id of [0, ""]) {
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => ({
          rows: input.operation === "select" ? [{ migration_id }] : [],
          rowsAffected: 0,
        }),
        kind: "postgres",
      });

      await expect(runDatabaseMigrations({ database })).rejects.toThrow(
        "Migration runner received an invalid schema_migrations row",
      );
    }
  });

  it("rejects missing and malformed TiDB version metadata", async () => {
    for (const rawVersion of [undefined, "not-a-tidb-version"]) {
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          if (input.operation === "select" && input.sql.includes("VERSION()")) {
            return {
              rows: [{ tidb_version: rawVersion }],
              rowsAffected: 0,
            };
          }

          if (input.operation === "select") {
            return {
              rows: migrationsBeforeCheckConstraints.map((migration_id) => ({ migration_id })),
              rowsAffected: 0,
            };
          }

          return { rows: [], rowsAffected: 0 };
        },
        kind: "tidb",
      });

      await expect(runDatabaseMigrations({ database })).rejects.toThrow(
        "requires TiDB 7.2 or newer",
      );
    }
  });

  it("rejects missing and non-string TiDB SHOW CREATE TABLE metadata", async () => {
    for (const createTableRow of [undefined, { create_table: 42 }]) {
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          if (input.operation === "select" && input.sql.includes("VERSION()")) {
            return {
              rows: [
                {
                  check_constraint_enabled: "ON",
                  foreign_key_checks_enabled: "ON",
                  foreign_key_enabled: "ON",
                  tidb_version: "5.7.25-TiDB-v8.5.0",
                },
              ],
              rowsAffected: 0,
            };
          }

          if (input.operation === "select" && input.sql.includes("SHOW CREATE TABLE")) {
            return {
              rows: createTableRow ? [createTableRow] : [],
              rowsAffected: 0,
            };
          }

          if (input.operation === "select") {
            return {
              rows: allMigrationIds.map((migration_id) => ({ migration_id })),
              rowsAffected: 0,
            };
          }

          return { rows: [], rowsAffected: 0 };
        },
        kind: "tidb",
      });

      await expect(runDatabaseMigrations({ database })).rejects.toThrow(
        "requires 3 valid FOREIGN KEY constraints on document_compilation_attempts",
      );
    }
  });
});

function showCreateTableResult(tableName: string): DatabaseExecuteResult {
  const foreignKeys =
    tableName === "document_compilation_attempts"
      ? [
          "document_compilation_attempts_asset_version_fk",
          "document_compilation_attempts_candidate_fk",
          "document_compilation_attempts_space_fk",
        ]
      : ["document_compilation_outbox_attempt_fk"];
  return {
    rows: [
      {
        "Create Table": `CREATE TABLE \`${tableName}\` (${foreignKeys
          .map(
            (constraintName, index) =>
              `CONSTRAINT \`${constraintName}\` FOREIGN KEY (\`child_${index}\`) REFERENCES \`parent\` (\`id\`)`,
          )
          .join(", ")})`,
      },
    ],
    rowsAffected: 0,
  };
}

function isTenantLengthPreflight(input: DatabaseExecuteInput): boolean {
  return (
    input.operation === "select" &&
    input.tableName === "knowledge_spaces" &&
    input.sql.includes("CHAR_LENGTH")
  );
}
