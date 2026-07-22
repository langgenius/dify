import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0025_capability_grant_provenance.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0025_capability_grant_provenance.tidb.sql"),
  "utf8",
);

const tables = [
  "capability_grants",
  "capability_space_fences",
  "capability_revoke_receipts",
] as const;

describe("capability grant provenance migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)("keeps the durable authorization closure symmetric on %s", (_dialect, sql, quote) => {
    for (const table of tables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${quote}${table}${quote}`);
    }
    expect(sql).toContain("capability_grants_state_ck");
    expect(sql).toContain("capability_grants_digest_ck");
    expect(sql).toContain("capability_revoke_receipts_target_ck");
    expect(sql).toContain(`${quote}tombstoned${quote}`);
    expect(sql).toContain("capability_grants_jti_hash_uq");
    expect(sql).toContain("highest_revoke_sequence");
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql.toLowerCase()).not.toContain("bearer_token");
    expect(sql.toLowerCase()).not.toContain("raw_jti");
  });

  it("keeps the schema catalog aligned with scoped keys and audit indexes", () => {
    const schema = getDatabaseSchema();
    for (const table of tables) {
      expect(schema.tables.some((candidate) => candidate.name === table)).toBe(true);
    }
    expect(schema.tables.find((table) => table.name === "capability_grants")?.primaryKey).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "grant_id",
    ]);
    expect(
      schema.indexes.find((index) => index.name === "capability_grants_jti_hash_uq"),
    ).toMatchObject({ columns: ["jti_hash"], unique: true });
    expect(
      schema.indexes.find(
        (index) => index.name === "capability_revoke_receipts_scope_sequence_idx",
      ),
    ).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "revoke_sequence", "received_at"],
    });
  });
});
