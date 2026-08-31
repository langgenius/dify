import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");

describe("parse artifact checkpoint migration", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`keeps raw parser output isolated and asset-scoped on ${dialect}`, () => {
      const quote = dialect === "postgres" ? '"' : "`";
      const sql = readFileSync(
        resolve(
          root,
          `packages/database/migrations/0047_parse_artifact_checkpoints.${dialect}.sql`,
        ),
        "utf8",
      );

      expect(sql).toContain("parse_artifact_checkpoints");
      expect(sql).toContain(`${quote}policy_fingerprint${quote}`);
      expect(sql).toContain(`${quote}artifact${quote}`);
      expect(sql).toContain("parse_artifact_checkpoints_asset_fk");
      expect(sql).toContain("ON DELETE CASCADE");
      expect(sql).toContain("parse_artifact_checkpoints_asset_version_uq");
      expect(sql).not.toContain('parse_artifacts" (');
      expect(sql).not.toContain("parse_artifacts` (");
    });
  }

  it("keeps the schema catalog aligned with the migration", () => {
    const table = getDatabaseSchema().tables.find(
      (candidate) => candidate.name === "parse_artifact_checkpoints",
    );

    expect(table?.columns.map((column) => column.name)).toEqual([
      "document_asset_id",
      "version",
      "policy_fingerprint",
      "artifact",
      "created_at",
      "updated_at",
    ]);
    expect(table?.foreignKeys?.[0]).toMatchObject({
      columns: ["document_asset_id"],
      onDelete: "CASCADE",
      referencedTable: "document_assets",
    });
    expect(table?.checkConstraints?.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "parse_artifact_checkpoints_version_ck",
        "parse_artifact_checkpoints_policy_fingerprint_ck",
        "parse_artifact_checkpoints_artifact_ck",
      ]),
    );
  });
});
