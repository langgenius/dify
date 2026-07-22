import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { describe, expect, it } from "vitest";

import { runApiDatabaseMigrations } from "./migrate";

describe("runApiDatabaseMigrations", () => {
  it("runs checked-in migrations through the configured adapter and closes it", async () => {
    const operations: string[] = [];
    const migrationSql: string[] = [];
    let closed = false;
    const database = createSchemaDatabaseAdapter({
      close: async () => {
        closed = true;
      },
      executor: async (input) => {
        operations.push(input.operation);
        if (input.operation === "schema" && input.sql.includes("-- Migration id:")) {
          migrationSql.push(input.sql);
        }

        if (input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }

        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      },
      kind: "postgres",
    });

    await expect(
      runApiDatabaseMigrations({
        adapter: {
          database,
        },
        env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs" },
        log: () => undefined,
        now: () => "2026-05-21T00:00:00.000Z",
      }),
    ).resolves.toEqual({
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
      pendingBeforeRun: 29,
    });
    expect(operations).toEqual([
      "schema",
      "select",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "select",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
      "schema",
      "insert",
    ]);
    expect(migrationSql).toHaveLength(29);
    expect(migrationSql[2]).toContain("-- Migration id: 0003_projection_set_publications\n");
    expect(migrationSql[2]).toContain("-- Dialect: postgres\n");
    expect(migrationSql[2]).toContain('CREATE TABLE IF NOT EXISTS "projection_set_publications"');
    expect(migrationSql[3]).toContain("-- Migration id: 0004_projection_publication_members\n");
    expect(migrationSql[3]).toContain(
      'CREATE TABLE IF NOT EXISTS "projection_set_publication_members"',
    );
    expect(migrationSql[4]).toContain("-- Migration id: 0005_publication_generation_nonzero\n");
    expect(migrationSql[5]).toContain("-- Migration id: 0006_document_compilation_attempts\n");
    expect(migrationSql[6]).toContain("-- Migration id: 0007_knowledge_node_generations\n");
    expect(migrationSql[7]).toContain("-- Migration id: 0008_flattened_page_index\n");
    expect(migrationSql[8]).toContain("-- Migration id: 0009_legacy_space_bootstrap\n");
    expect(migrationSql[9]).toContain("-- Migration id: 0010_page_index_upgrade_backfill\n");
    expect(migrationSql[10]).toContain("-- Migration id: 0011_tidb_fts_postings\n");
    expect(migrationSql[11]).toContain("-- Migration id: 0012_tidb_baseline_repair\n");
    expect(migrationSql[12]).toContain("-- Migration id: 0013_space_access_control\n");
    expect(migrationSql[13]).toContain("-- Migration id: 0014_source_credential_refs\n");
    expect(migrationSql[13]).toContain('CREATE TABLE IF NOT EXISTS "source_secret_lifecycle_refs"');
    expect(migrationSql[13]).toContain(
      "source credential_ref is missing a matching active lifecycle registry row",
    );
    expect(migrationSql[14]).toContain("-- Migration id: 0015_research_task_jobs\n");
    expect(migrationSql[15]).toContain("-- Migration id: 0016_compilation_job_requester_binding\n");
    expect(migrationSql[16]).toContain("-- Migration id: 0017_durable_deletion\n");
    expect(migrationSql[16]).toContain('CREATE TABLE IF NOT EXISTS "deletion_jobs"');
    expect(migrationSql[17]).toContain("-- Migration id: 0018_versioned_space_profiles\n");
    expect(migrationSql[18]).toContain("-- Migration id: 0019_profile_publication_bindings\n");
    expect(migrationSql[19]).toContain("-- Migration id: 0020_profile_migration_runs\n");
    expect(migrationSql[20]).toContain("-- Migration id: 0021_source_product_workflows\n");
    expect(migrationSql[21]).toContain("-- Migration id: 0022_logical_document_revisions\n");
    expect(migrationSql[22]).toContain("-- Migration id: 0023_knowledge_space_overview\n");
    expect(migrationSql[23]).toContain("-- Migration id: 0024_quality_control\n");
    expect(migrationSql[24]).toContain("-- Migration id: 0025_capability_grant_provenance\n");
    expect(migrationSql[25]).toContain("-- Migration id: 0026_capability_job_provenance\n");
    expect(migrationSql[26]).toContain("-- Migration id: 0027_upload_sessions\n");
    expect(migrationSql[27]).toContain("-- Migration id: 0028_dify_integration_states\n");
    expect(migrationSql[28]).toContain("-- Migration id: 0029_dify_integration_freezes\n");
    expect(closed).toBe(true);
  });

  it("fails fast when DATABASE_URL is missing", async () => {
    await expect(
      runApiDatabaseMigrations({
        adapter: {
          database: createSchemaDatabaseAdapter({ kind: "postgres" }),
        },
        env: {},
        log: () => undefined,
      }),
    ).rejects.toThrow("DATABASE_URL is required to run local database migrations");
  });
});

describe("local database migration command", () => {
  it("is exposed from the root package and documented", () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const readme = readFileSync(resolve(import.meta.dirname, "../../../README.md"), "utf8");

    expect(rootPackage.scripts?.["local:db:migrate"]).toContain("apps/api/src/migrate.ts");
    expect(rootPackage.scripts?.["local:db:migrate"]).toContain(
      "--env-file-if-exists=infra/local/.env",
    );
    expect(readme).toContain("pnpm local:db:migrate");
  });
});
