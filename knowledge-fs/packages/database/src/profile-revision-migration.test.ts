import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0018_versioned_space_profiles.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0018_versioned_space_profiles.tidb.sql"),
  "utf8",
);

describe("versioned profile migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)("persists a model-defined embedding dimension on %s", (_dialect, sql, quote) => {
    expect(sql).toContain(`${quote}kind${quote} = 'embedding'`);
    expect(sql).toContain(`${quote}vector_space_id${quote} IS NOT NULL`);
    expect(sql).toContain(`${quote}dimension${quote} IS NOT NULL`);
    expect(sql).toContain(`${quote}dimension${quote} >= 1`);
    expect(sql).toContain(
      `${quote}kind${quote} = 'retrieval' AND ${quote}vector_space_id${quote} IS NULL AND ${quote}dimension${quote} IS NULL`,
    );
    expect(sql).not.toContain("1536");
  });

  it("keeps every TiDB referenced profile identity inline and uses default RESTRICT", () => {
    const revisionTable = tidb.slice(
      tidb.indexOf("CREATE TABLE IF NOT EXISTS `knowledge_space_profile_revisions`"),
      tidb.indexOf(
        "CREATE INDEX IF NOT EXISTS `knowledge_space_profile_revisions_scope_state_idx`",
      ),
    );
    for (const constraint of [
      "knowledge_space_profile_revisions_scope_revision_uq",
      "knowledge_space_profile_revisions_head_fk_uq",
      "knowledge_space_profile_revisions_attempt_fk_uq",
    ]) {
      expect(revisionTable).toContain(`CONSTRAINT \`${constraint}\`\n    UNIQUE`);
    }
    expect(tidb).not.toContain("ON DELETE RESTRICT");
  });

  it("keeps the schema catalog dimension contract aligned", () => {
    const table = getDatabaseSchema().tables.find(
      (candidate) => candidate.name === "knowledge_space_profile_revisions",
    );
    const shape = table?.checkConstraints?.find(
      (constraint) => constraint.name === "knowledge_space_profile_revisions_vector_shape_ck",
    );
    expect(shape?.expression.postgres).toContain('"dimension" IS NOT NULL');
    expect(shape?.expression.tidb).toContain("`dimension` IS NOT NULL");
    expect(table?.columns.find((column) => column.name === "dimension")).toMatchObject({
      nullable: true,
    });
  });
});
