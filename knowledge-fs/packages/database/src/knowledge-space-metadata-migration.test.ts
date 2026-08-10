import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("knowledge-space metadata migration", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`creates the field catalog, document bindings, and legacy backfill for ${dialect}`, () => {
      const sql = readFileSync(
        resolve(root, `packages/database/migrations/0040_knowledge_space_metadata.${dialect}.sql`),
        "utf8",
      );

      expect(sql).toContain("knowledge_space_metadata_fields");
      expect(sql).toContain("logical_document_metadata_bindings");
      expect(sql).toContain("knowledge_space_metadata_fields_name_uq");
      expect(sql).toContain("logical_document_metadata_bindings_field_idx");
      expect(sql).toContain("migration:0040");
      expect(sql).toContain("'provenance', 'system'");
      expect(sql).toContain("ROW_NUMBER() OVER");
      expect(sql).toContain("field_rank <= 100");
      expect(sql).toContain("user_metadata");
    });
  }
});
