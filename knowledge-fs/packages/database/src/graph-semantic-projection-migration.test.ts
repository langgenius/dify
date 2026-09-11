import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDatabaseSchema, renderCreateTableSql } from "./schema";

describe.each(["postgres", "tidb"] as const)(
  "graph semantic projections migration (%s)",
  (dialect) => {
    it("is additive and scopes vectors by owner, generation and model with cascading cleanup", () => {
      const sql = readFileSync(
        new URL(`../migrations/0054_graph_semantic_projections.${dialect}.sql`, import.meta.url),
        "utf8",
      );
      for (const kind of ["entity", "relation"]) {
        const table = getDatabaseSchema().tables.find(
          (table) => table.name === `graph_${kind}_semantic_projections`,
        );
        assert(table);
        expect(table.primaryKey).toEqual(["owner_id", "vector_space_id"]);
        expect(table.foreignKeys).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              columns: ["owner_id"],
              onDelete: "CASCADE",
              referencedTable: kind === "entity" ? "graph_entities" : "graph_relations",
            }),
          ]),
        );
        const rendered = renderCreateTableSql(dialect, table);
        for (const name of [
          table.name,
          "publication_generation_id",
          "knowledge_space_id",
          "vector_space_id",
          "dimension",
          "representation_version",
          "content_hash",
          "vector",
        ]) {
          expect(sql).toContain(name);
          expect(rendered).toContain(name);
        }
      }
      expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE ["`]index_projections/i);
      expect(sql.match(/ON DELETE CASCADE/g)).toHaveLength(4);
    });
  },
);
