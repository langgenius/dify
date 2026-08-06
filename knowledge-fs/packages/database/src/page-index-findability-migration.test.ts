import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("PageIndex findability migration", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`persists exact-generation routes and a fenced repair queue for ${dialect}`, () => {
      const sql = readFileSync(
        resolve(root, `packages/database/migrations/0036_page_index_findability.${dialect}.sql`),
        "utf8",
      );
      expect(sql).toContain("page_index_findability_evaluations");
      expect(sql).toContain("publication_generation_id");
      expect(sql).toContain("recommended_route");
      expect(sql).toContain("summary_repair_state");
      expect(sql).toContain("compilation_attempt_id");
      expect(sql).toContain("page_index_findability_generation_evaluator_uq");
    });
  }
});
