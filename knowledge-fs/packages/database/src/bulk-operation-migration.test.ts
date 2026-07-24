import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0030_bulk_operations.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0030_bulk_operations.tidb.sql"),
  "utf8",
);

describe("bulk operation migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)(
    "persists task history with ACL, requester, and provenance fences on %s",
    (_dialect, sql, quote) => {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${quote}bulk_operations${quote}`);
      expect(sql).toContain("bulk_operations_type_ck");
      expect(sql).toContain("bulk_operations_items_ck");
      expect(sql).toContain("bulk_operations_scope_ck");
      expect(sql).toContain("bulk_operations_permission_ck");
      expect(sql).toContain("bulk_operations_authorization_ck");
      expect(sql).toContain("bulk_operations_capability_grant_fk");
      expect(sql).toContain("bulk_operations_permission_snapshot_fk");
      expect(sql).toContain("bulk_operations_space_created_idx");
      expect(sql).toContain("capability_grants");
      expect(sql).toContain("knowledge_space_permission_snapshots");
      expect(sql.toLowerCase()).not.toContain("bearer");
      expect(sql.toLowerCase()).not.toContain("raw_jti");
    },
  );

  it("keeps the schema catalog aligned with the durable list index", () => {
    const schema = getDatabaseSchema();
    expect(
      schema.indexes.find((index) => index.name === "bulk_operations_space_created_idx"),
    ).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
      tableName: "bulk_operations",
    });
  });
});
