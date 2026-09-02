import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");

describe("answer trace query images migration", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`adds a nullable JSON query_images column to answer_traces on ${dialect}`, () => {
      const quote = dialect === "postgres" ? '"' : "`";
      const sql = readFileSync(
        resolve(root, `packages/database/migrations/0049_answer_trace_query_images.${dialect}.sql`),
        "utf8",
      );

      expect(sql).toContain(`ALTER TABLE ${quote}answer_traces${quote}`);
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${quote}query_images${quote}`);
      expect(sql).toContain(dialect === "postgres" ? "JSONB" : "JSON NULL");
      expect(sql).not.toContain("NOT NULL");
    });
  }

  it("keeps the schema catalog aligned with the migration", () => {
    const table = getDatabaseSchema().tables.find(
      (candidate) => candidate.name === "answer_traces",
    );
    const column = table?.columns.find((candidate) => candidate.name === "query_images");

    expect(column).toMatchObject({
      nullable: true,
      type: { postgres: "JSONB", tidb: "JSON" },
    });
  });
});
