import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");

describe("0020 profile migration run artifacts", () => {
  it.each(["postgres", "tidb"] as const)(
    "is marker-loss replay safe and freezes the complete tuple for %s",
    async (dialect) => {
      const sql = await readFile(
        resolve(root, `packages/database/migrations/0020_profile_migration_runs.${dialect}.sql`),
        "utf8",
      );
      const quote = dialect === "postgres" ? '"' : "`";

      expect(sql).toContain(
        `CREATE TABLE IF NOT EXISTS ${quote}knowledge_space_profile_migration_runs${quote}`,
      );
      expect(sql).toContain(
        `CREATE TABLE IF NOT EXISTS ${quote}knowledge_space_profile_migration_outbox${quote}`,
      );
      expect(sql).toContain("candidate_profile_snapshot_digest");
      expect(sql).toContain("base_embedding_profile_snapshot_digest");
      expect(sql).toContain("base_retrieval_profile_snapshot_digest");
      expect(sql).toContain("base_publication_head_revision");
      expect(sql).toContain("permission_snapshot_revision");
      expect(sql).toContain("requested_by_subject_id");
      expect(sql).toContain("access_channel");
      expect(sql).toContain("idempotency_digest");
      expect(sql).toContain("profile_migration_runs_idempotency_digest_uq");
      expect(sql).toContain("profile_migration_runs_checkpoint_shape_ck");
      expect(sql).toContain("full-vector-space");
      expect(sql).toContain("full-page-index-summary-outline");
      expect(sql).toContain("clone-publication");
      expect(sql).toContain("active_slot");
      expect(sql).toContain("profile_migration_runs_active_uq");
      expect(sql).not.toMatch(/ALTER TABLE[\s\S]+ADD CONSTRAINT/iu);
      expect(sql).not.toMatch(/\bDROP\s+TABLE\b/iu);
      expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
      expect(sql).not.toContain("profile_migration_runs_idempotency_uq\n  ON");
    },
  );

  it("uses TiDB default RESTRICT for CHECK-constrained foreign-key columns", async () => {
    const sql = await readFile(
      resolve(root, "packages/database/migrations/0020_profile_migration_runs.tidb.sql"),
      "utf8",
    );
    expect(sql).not.toContain("ON DELETE RESTRICT");
  });

  it("keeps digest and terminal checkpoint invariants in the schema catalog", () => {
    const schema = getDatabaseSchema();
    const runs = schema.tables.find(
      (table) => table.name === "knowledge_space_profile_migration_runs",
    );
    expect(runs?.columns.find((column) => column.name === "idempotency_digest")).toBeDefined();
    expect(
      runs?.checkConstraints?.find(
        (constraint) =>
          constraint.name === "knowledge_space_profile_migration_runs_checkpoint_shape_ck",
      ),
    ).toBeDefined();
    expect(
      schema.indexes.find(
        (index) => index.name === "knowledge_space_profile_migration_runs_idempotency_digest_uq",
      ),
    ).toMatchObject({ columns: ["idempotency_digest"], unique: true });
    expect(
      schema.indexes.some(
        (index) => index.name === "knowledge_space_profile_migration_runs_idempotency_uq",
      ),
    ).toBe(false);
  });
});
