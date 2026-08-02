import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0035_research_task_answer_streaming.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0035_research_task_answer_streaming.tidb.sql"),
  "utf8",
);

describe("0035 Research task answer streaming migration", () => {
  it("replaces the progress event constraint with answer delta support", () => {
    expect(postgres).toContain('DROP CONSTRAINT IF EXISTS "research_task_progress_event_ck"');
    expect(postgres).toContain("'research_task.answer_delta'");
    expect(tidb).toContain(
      "ALTER TABLE `research_task_progress_events` DROP CHECK `research_task_progress_event_ck`",
    );
    expect(tidb).toContain("''research_task.answer_delta''");
    expect(postgres).not.toMatch(/\b(?:DELETE|UPDATE)\b/u);
    expect(tidb).not.toMatch(/\b(?:DELETE|UPDATE)\b/u);
  });
});
