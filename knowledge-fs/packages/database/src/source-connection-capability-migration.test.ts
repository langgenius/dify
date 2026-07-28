import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(
    root,
    "packages/database/migrations/0031_source_connection_capability_provenance.postgres.sql",
  ),
  "utf8",
);
const tidb = readFileSync(
  resolve(
    root,
    "packages/database/migrations/0031_source_connection_capability_provenance.tidb.sql",
  ),
  "utf8",
);

describe("0031 source-connection Capability provenance migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)(
    "adds a replay-safe grant locator, foreign key, and lookup index for %s",
    (_dialect, sql, quote) => {
      expect(sql).toContain(`ALTER TABLE ${quote}source_connections${quote}`);
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${quote}capability_grant_id${quote}`);
      expect(sql).toContain("source_connections_capability_grant_fk");
      expect(sql).toContain("source_connections_capability_grant_idx");
      expect(sql).toMatch(
        /FOREIGN KEY \([`"]tenant_id[`"], [`"]knowledge_space_id[`"], [`"]capability_grant_id[`"]\)/u,
      );
      expect(sql).toMatch(
        /REFERENCES [`"]capability_grants[`"] \([`"]tenant_id[`"], [`"]knowledge_space_id[`"], [`"]grant_id[`"]\)/u,
      );
      expect(sql).toContain("ON DELETE RESTRICT");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
    },
  );

  it("guards the foreign key when a migration marker is lost", () => {
    expect(postgres).toContain("FROM pg_constraint");
    expect(postgres).toContain("IF NOT EXISTS");
    expect(tidb).toContain("FROM information_schema.table_constraints");
    expect(tidb).toContain("@source_connection_capability_fk_exists = 0");
    expect(tidb).toContain("DEALLOCATE PREPARE source_connection_capability_fk_statement");
  });
});
