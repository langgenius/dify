import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0032_capability_source_sync_policies.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0032_capability_source_sync_policies.tidb.sql"),
  "utf8",
);

describe("0032 Capability source sync policy provenance migration", () => {
  it.each([
    ["postgres", postgres],
    ["tidb", tidb],
  ] as const)("keeps Capability and legacy authorization mutually exclusive on %s", (_, sql) => {
    expect(sql).toContain("capability_grant_id");
    expect(sql).toContain("source_sync_policies_authorization_binding_ck");
    expect(sql).toContain("source_sync_policies_capability_grant_fk");
    expect(sql).toContain("source_sync_policies_capability_grant_idx");
    expect(sql).toContain("permission_snapshot_id");
    expect(sql).toContain("required_permission_scope");
    expect(sql.toLowerCase()).not.toContain("bearer");
    expect(sql.toLowerCase()).not.toContain("raw_jti");
  });

  it("models the nullable provenance union and scoped foreign key in the schema catalog", () => {
    const schema = getDatabaseSchema();
    const table = schema.tables.find((candidate) => candidate.name === "source_sync_policies");
    expect(table?.columns.find((column) => column.name === "capability_grant_id")).toMatchObject({
      nullable: true,
    });
    for (const column of [
      "requested_by_subject_id",
      "access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "required_permission_scope",
    ]) {
      expect(table?.columns.find((candidate) => candidate.name === column)).toMatchObject({
        nullable: true,
      });
    }
    expect(table?.foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["tenant_id", "knowledge_space_id", "capability_grant_id"],
          onDelete: "RESTRICT",
          referencedColumns: ["tenant_id", "knowledge_space_id", "grant_id"],
          referencedTable: "capability_grants",
        }),
      ]),
    );
    expect(
      schema.indexes.find((index) => index.name === "source_sync_policies_capability_grant_idx"),
    ).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "capability_grant_id"],
    });
  });

  it("guards new TiDB constraints when a committed DDL marker is lost", () => {
    expect(postgres).toContain("FROM pg_constraint");
    expect(tidb).toContain("FROM information_schema.tidb_check_constraints");
    expect(tidb).toContain("FROM information_schema.referential_constraints");
    expect(tidb).toContain("PREPARE kfs_0032_source_sync_policy_authorization_stmt");
    expect(tidb).toContain("PREPARE kfs_0032_source_sync_policy_capability_fk_stmt");
    expect(tidb.match(/'DO 0'/gu)).toHaveLength(2);
  });
});
