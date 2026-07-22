import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0019_profile_publication_bindings.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0019_profile_publication_bindings.tidb.sql"),
  "utf8",
);

describe("profile/publication binding migration", () => {
  it("is replay-safe after DDL commits before the migration ledger marker", () => {
    expect(postgres.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(8);
    expect(postgres.match(/"conrelid" = 'document_compilation_attempts'::regclass/g)).toHaveLength(
      5,
    );
    expect(postgres.match(/IF NOT EXISTS \(SELECT 1 FROM "pg_constraint"/g)).toHaveLength(5);
    expect(postgres).toContain(
      'CREATE TABLE IF NOT EXISTS "knowledge_space_profile_publication_bindings"',
    );

    expect(tidb.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(8);
    expect(tidb.match(/'DO 0'/g)).toHaveLength(5);
    expect(tidb.match(/DEALLOCATE PREPARE attempt_/g)).toHaveLength(5);
    expect(tidb.match(/information_schema\.tidb_check_constraints/g)).toHaveLength(3);
    expect(tidb.match(/information_schema\.referential_constraints/g)).toHaveLength(2);
    expect(tidb).toContain(
      "CREATE TABLE IF NOT EXISTS `knowledge_space_profile_publication_bindings`",
    );
  });

  it("freezes exact optional embedding and retrieval snapshots on compilation attempts", () => {
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("embedding_profile_revision_id");
      expect(sql).toContain("embedding_profile_snapshot_digest");
      expect(sql).toContain("retrieval_profile_revision_id");
      expect(sql).toContain("retrieval_profile_snapshot_digest");
      expect(sql).toContain("knowledge_space_profile_revisions_attempt_fk_uq");
      expect(sql).toContain("document_compilation_attempts_profile_tuple_ck");
      expect(sql).not.toContain("1536");
    }
  });

  it("models one immutable runtime tuple per publication and supports Research-only bootstrap", () => {
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("knowledge_space_profile_publication_bindings_publication_uq");
      expect(sql).toContain("legacy-bootstrap");
      expect(sql).toContain("content-publication");
      expect(sql).toContain("bootstrap");
      expect(sql).toContain("content");
      expect(sql).toMatch(/changed_kind[^\n]+IN \([^\n]+retrieval[^\n]+bootstrap/);
    }

    const schema = getDatabaseSchema();
    const binding = schema.tables.find(
      (table) => table.name === "knowledge_space_profile_publication_bindings",
    );
    const attempt = schema.tables.find((table) => table.name === "document_compilation_attempts");
    expect(
      binding?.columns.find((column) => column.name === "embedding_profile_revision_id"),
    ).toMatchObject({ nullable: true });
    expect(binding?.foreignKeys).toHaveLength(4);
    expect(attempt?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "embedding_profile_revision_id",
        "embedding_profile_snapshot_digest",
        "retrieval_profile_revision_id",
        "retrieval_profile_snapshot_digest",
      ]),
    );
    expect(
      schema.indexes.find(
        (index) => index.name === "knowledge_space_profile_publication_bindings_publication_uq",
      ),
    ).toMatchObject({ unique: true });
    expect(
      attempt?.checkConstraints?.find(
        (constraint) => constraint.name === "document_compilation_attempts_profile_tuple_ck",
      ),
    ).toBeDefined();
  });

  it("protects historical profile/publication audit tuples until GC deletes bindings first", () => {
    const schema = getDatabaseSchema();
    const binding = schema.tables.find(
      (table) => table.name === "knowledge_space_profile_publication_bindings",
    );
    const protectedForeignKeys = binding?.foreignKeys?.filter(
      (foreignKey) =>
        foreignKey.referencedTable === "knowledge_space_profile_revisions" ||
        foreignKey.referencedTable === "projection_set_publications",
    );
    expect(protectedForeignKeys).toHaveLength(3);
    expect(protectedForeignKeys?.every((foreignKey) => foreignKey.onDelete === "RESTRICT")).toBe(
      true,
    );

    const tableOrder = schema.tables.map((table) => table.name);
    expect(tableOrder.indexOf("projection_set_publications")).toBeLessThan(
      tableOrder.indexOf("knowledge_space_profile_publication_bindings"),
    );
    expect(postgres.match(/ON DELETE RESTRICT/g)?.length).toBeGreaterThanOrEqual(5);
    // TiDB's omitted action is RESTRICT; spelling it explicitly is incompatible with CHECKs on
    // these child columns in supported TiDB versions.
    expect(tidb).not.toContain(") ON DELETE RESTRICT");
  });
});
