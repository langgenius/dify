import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0026_capability_job_provenance.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0026_capability_job_provenance.tidb.sql"),
  "utf8",
);

const jobTables = [
  "research_task_jobs",
  "answer_traces",
  "document_compilation_attempts",
  "knowledge_space_profile_migration_runs",
  "source_workflow_runs",
  "quality_replay_runs",
  "deletion_jobs",
] as const;

describe("capability job provenance migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)("keeps all integrated pipelines symmetric on %s", (_dialect, sql, quote) => {
    for (const table of jobTables) {
      expect(sql).toContain(`ALTER TABLE ${quote}${table}${quote}`);
      expect(sql).toContain(`${quote}capability_grant_id${quote}`);
      expect(sql).toContain(`${table}_capability_grant_fk`);
      expect(sql).toContain(`${table}_authorization_binding_ck`);
    }
    expect(sql).toContain("REFERENCES");
    expect(sql).toContain(`${quote}capability_grants${quote}`);
    expect(sql).toContain(`ALTER TABLE ${quote}document_revisions${quote}`);
    expect(sql).toContain("document_revisions_capability_grant_fk");
    expect(sql).toContain(`ALTER TABLE ${quote}deletion_retry_audits${quote}`);
    expect(sql).toContain("deletion_retry_audits_capability_grant_fk");
    expect(sql).toContain("deletion_retry_audits_authorization_binding_ck");
    expect(sql).toContain("permission_snapshot_id");
    expect(sql.toLowerCase()).not.toContain("bearer_token");
    expect(sql.toLowerCase()).not.toContain("raw_jti");
  });

  it("aligns the schema catalog with nullable legacy bindings and grant indexes", () => {
    const schema = getDatabaseSchema();
    for (const tableName of jobTables) {
      const table = schema.tables.find((candidate) => candidate.name === tableName);
      expect(table?.columns.some((column) => column.name === "capability_grant_id")).toBe(true);
      expect(
        table?.foreignKeys?.some(
          (foreignKey) =>
            foreignKey.referencedTable === "capability_grants" &&
            foreignKey.columns.includes("capability_grant_id"),
        ),
      ).toBe(true);
      expect(
        schema.indexes.some(
          (index) => index.tableName === tableName && index.columns.includes("capability_grant_id"),
        ),
      ).toBe(true);
    }
    const research = schema.tables.find((table) => table.name === "research_task_jobs");
    const revisions = schema.tables.find((table) => table.name === "document_revisions");
    const deletionRetryAudits = schema.tables.find(
      (table) => table.name === "deletion_retry_audits",
    );
    expect(revisions?.columns.some((column) => column.name === "capability_grant_id")).toBe(true);
    expect(
      revisions?.foreignKeys?.some(
        (foreignKey) => foreignKey.referencedTable === "capability_grants",
      ),
    ).toBe(true);
    expect(
      deletionRetryAudits?.foreignKeys?.some(
        (foreignKey) => foreignKey.referencedTable === "capability_grants",
      ),
    ).toBe(true);
    expect(
      schema.indexes.some(
        (index) =>
          index.tableName === "deletion_retry_audits" &&
          index.columns.includes("capability_grant_id"),
      ),
    ).toBe(true);
    for (const columnName of [
      "subject_id",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "access_channel",
    ]) {
      expect(research?.columns.find((column) => column.name === columnName)?.nullable).toBe(true);
    }
  });
});
