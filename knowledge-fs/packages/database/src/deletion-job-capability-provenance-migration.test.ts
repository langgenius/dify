import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");

describe("deletion job capability provenance migration", () => {
  it.each([
    ["postgres", "DROP CONSTRAINT IF EXISTS", '"'],
    ["tidb", "DROP FOREIGN KEY", "`"],
  ] as const)("drops the live grant foreign keys on %s", (dialect, statement, quote) => {
    const sql = readFileSync(
      resolve(
        root,
        `packages/database/migrations/0050_deletion_job_capability_provenance.${dialect}.sql`,
      ),
      "utf8",
    );
    expect(sql).toContain(`${statement} ${quote}deletion_jobs_capability_grant_fk${quote}`);
    expect(sql).toContain(`${statement} ${quote}deletion_retry_audits_capability_grant_fk${quote}`);
    expect(sql).not.toContain("DROP COLUMN");
  });

  it("keeps the grant id as provenance without a live schema foreign key", () => {
    const table = getDatabaseSchema().tables.find(
      (candidate) => candidate.name === "deletion_jobs",
    );
    expect(table?.columns.some((column) => column.name === "capability_grant_id")).toBe(true);
    expect(
      table?.foreignKeys?.some((foreignKey) => foreignKey.columns.includes("capability_grant_id")),
    ).toBe(false);
    const audits = getDatabaseSchema().tables.find(
      (candidate) => candidate.name === "deletion_retry_audits",
    );
    expect(audits?.columns.some((column) => column.name === "capability_grant_id")).toBe(true);
    expect(
      audits?.foreignKeys?.some((foreignKey) => foreignKey.columns.includes("capability_grant_id")),
    ).toBe(false);
  });
});
