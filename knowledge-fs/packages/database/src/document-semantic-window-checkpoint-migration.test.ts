import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");

describe("document semantic window checkpoint migration", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`keeps checkpoints tenant- and generation-scoped on ${dialect}`, () => {
      const quote = dialect === "postgres" ? '"' : "`";
      const sql = readFileSync(
        resolve(
          root,
          `packages/database/migrations/0044_document_semantic_window_checkpoints.${dialect}.sql`,
        ),
        "utf8",
      );

      expect(sql).toContain("document_semantic_window_checkpoints");
      expect(sql).toContain(`${quote}tenant_id${quote}`);
      expect(sql).toContain(`${quote}publication_generation_id${quote}`);
      expect(sql).toContain("document_semantic_window_checkpoints_scope_fk");
      expect(sql).toContain("document_semantic_window_checkpoints_asset_fk");
      expect(sql).toContain("document_semantic_window_checkpoints_fingerprint_ck");
    });
  }

  it("uses a TiDB text type large enough for the bounded semantic response", () => {
    const sql = readFileSync(
      resolve(
        root,
        "packages/database/migrations/0044_document_semantic_window_checkpoints.tidb.sql",
      ),
      "utf8",
    );

    expect(sql).toContain("`response_text` MEDIUMTEXT NOT NULL");
  });

  it("keeps the schema catalog aligned with the migration", () => {
    const table = getDatabaseSchema().tables.find(
      (candidate) => candidate.name === "document_semantic_window_checkpoints",
    );

    expect(table?.primaryKey).toEqual([
      "tenant_id",
      "knowledge_space_id",
      "publication_generation_id",
      "window_id",
      "input_fingerprint",
    ]);
    expect(table?.columns.find((column) => column.name === "response_text")?.type).toEqual({
      postgres: "TEXT",
      tidb: "MEDIUMTEXT",
    });
    expect(table?.foreignKeys?.map((foreignKey) => foreignKey.name)).toEqual(
      expect.arrayContaining([
        "document_semantic_window_checkpoints_scope_fk",
        "document_semantic_window_checkpoints_asset_fk",
      ]),
    );
  });
});
