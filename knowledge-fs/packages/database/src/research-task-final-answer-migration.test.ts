import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0033_research_task_final_answers.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0033_research_task_final_answers.tidb.sql"),
  "utf8",
);

describe("0033 Research task final answers migration", () => {
  it("adds a nullable durable answer column without rewriting existing evidence rows", () => {
    expect(postgres).toContain('ALTER TABLE "research_task_partial_results"');
    expect(postgres).toContain('ADD COLUMN IF NOT EXISTS "answer" TEXT');
    expect(tidb).toContain("ALTER TABLE `research_task_partial_results`");
    expect(tidb).toContain("ADD COLUMN IF NOT EXISTS `answer` TEXT NULL");
    expect(postgres).not.toMatch(/\b(?:DELETE|DROP|UPDATE)\b/u);
    expect(tidb).not.toMatch(/\b(?:DELETE|DROP|UPDATE)\b/u);
  });
});
