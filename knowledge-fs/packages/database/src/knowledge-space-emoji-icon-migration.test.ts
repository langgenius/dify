import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0034_knowledge_space_emoji_icons.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0034_knowledge_space_emoji_icons.tidb.sql"),
  "utf8",
);

describe("knowledge-space emoji icon migration", () => {
  it("replaces the icon constraint replay-safely in both dialects", () => {
    expect(postgres).toContain('DROP CONSTRAINT IF EXISTS "knowledge_spaces_icon_ref_ck"');
    expect(postgres).toContain("'^(builtin:)?[+a-z0-9_-]{1,64}$'");

    expect(tidb).toContain("FROM information_schema.tidb_check_constraints");
    expect(tidb).toContain("DROP CHECK `knowledge_spaces_icon_ref_ck`");
    expect(tidb).toContain("'DO 0'");
    expect(tidb).toContain("DEALLOCATE PREPARE kfs_0034_icon_constraint_stmt");
    expect(tidb).toContain("''^(builtin:)?[+a-z0-9_-]{1,64}$''");
  });

  it("keeps the final schema aligned with Dify emoji identities", () => {
    const schema = getDatabaseSchema();
    const space = schema.tables.find((table) => table.name === "knowledge_spaces");
    const constraint = space?.checkConstraints?.find(
      (candidate) => candidate.name === "knowledge_spaces_icon_ref_ck",
    );

    expect(constraint?.expression.postgres).toContain("(builtin:)?[+a-z0-9_-]{1,64}");
    expect(constraint?.expression.tidb).toContain("(builtin:)?[+a-z0-9_-]{1,64}");
  });
});
