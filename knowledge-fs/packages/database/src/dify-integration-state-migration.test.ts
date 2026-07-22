import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrations = new URL("../migrations/", import.meta.url);

describe.each(["postgres", "tidb"] as const)("Dify integration state migration (%s)", (dialect) => {
  it("persists one-way tenant activation with monotonic evidence", async () => {
    const sql = await readFile(
      fileURLToPath(new URL(`0028_dify_integration_states.${dialect}.sql`, migrations)),
      "utf8",
    );

    expect(sql).toContain("dify_integration_states");
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("activation_revision");
    expect(sql).toContain("source_revision_digest");
    expect(sql).toContain("activation_revision");
    expect(sql).toContain("sha256:");
    expect(sql.toLowerCase()).not.toContain("deactivated");
  });
});
