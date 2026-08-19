import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");

describe("quality replay match-policy migration", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`backfills and constrains the frozen match policy on ${dialect}`, () => {
      const quote = dialect === "postgres" ? '"' : "`";
      const sql = readFileSync(
        resolve(
          root,
          `packages/database/migrations/0045_quality_replay_match_policy.${dialect}.sql`,
        ),
        "utf8",
      );

      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${quote}match_policy${quote} VARCHAR(8)`);
      expect(sql).toContain(`SET ${quote}match_policy${quote} = 'all'`);
      expect(sql).toContain("quality_replay_items_match_policy_ck");
      expect(sql).toContain(`CHECK (${quote}match_policy${quote} IN ('all', 'any'))`);
    });
  }

  it("keeps the schema catalog aligned with the durable replay item contract", () => {
    const replayItems = getDatabaseSchema().tables.find(
      (table) => table.name === "quality_replay_items",
    );

    expect(replayItems?.columns.find((column) => column.name === "match_policy")).toMatchObject({
      nullable: false,
      type: { postgres: "VARCHAR(8)", tidb: "VARCHAR(8)" },
    });
    expect(
      replayItems?.checkConstraints?.find(
        (constraint) => constraint.name === "quality_replay_items_match_policy_ck",
      ),
    ).toMatchObject({
      expression: {
        postgres: `"match_policy" IN ('all', 'any')`,
        tidb: "`match_policy` IN ('all', 'any')",
      },
    });
  });
});
