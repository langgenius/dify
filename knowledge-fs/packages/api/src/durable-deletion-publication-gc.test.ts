import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  deleteHistoricalPublicationResiduePage,
  deleteHistoricalPublicationResiduePageWithExecutor,
  hasHistoricalPublicationResidue,
} from "./durable-deletion-publication-gc";

const scope = {
  documentAssetIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c43"],
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  maxDocumentAssetIds: 10,
  tenantId: "tenant-1",
} as const;

describe("historical publication durable-deletion GC", () => {
  it.each(["postgres", "tidb"] as const)(
    "deletes a bounded target-bearing %s publication as an immutable unit",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "projection_set_publications") {
          return {
            rows: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c90" }],
            rowsAffected: 1,
          };
        }
        return { rows: [], rowsAffected: input.operation === "delete" ? 1 : 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async (callback) => callback({ execute: executor }),
      });

      await expect(
        deleteHistoricalPublicationResiduePage(database, { ...scope, limit: 3 }),
      ).resolves.toBe(1);

      const candidate = calls.find(
        (call) => call.operation === "select" && call.tableName === "projection_set_publications",
      );
      expect(candidate?.maxRows).toBe(3);
      expect(candidate?.sql).toContain("projection_set_publication_members");
      expect(candidate?.sql).toContain("projectionSetFingerprintMaterial");
      expect(candidate?.sql).toContain("sourceSnapshots");
      expect(candidate?.sql).toContain("NOT EXISTS");
      expect(candidate?.sql).toContain("FOR UPDATE");
      expect(candidate?.sql).not.toContain(scope.documentAssetIds[0]);

      expect(
        calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
      ).toEqual([
        "knowledge_space_profile_publication_bindings",
        "document_compilation_attempts",
        "legacy_space_publication_bootstraps",
        "page_index_upgrade_backfills",
        "projection_set_publication_members",
        "projection_set_publications",
      ]);
      const parentDelete = calls.at(-1);
      expect(parentDelete?.tableName).toBe("projection_set_publications");
      expect(parentDelete?.sql).toContain("projection_set_publication_heads");
      if (kind === "tidb") {
        for (const call of calls) {
          expect(call.sql.match(/\?/g) ?? []).toHaveLength(call.params.length);
        }
      }
    },
  );

  it("uses the caller's fenced executor without opening a nested transaction", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async () => {
        throw new Error("nested transaction must not be opened");
      },
    });

    await expect(
      deleteHistoricalPublicationResiduePageWithExecutor(
        database,
        { execute: executor },
        {
          ...scope,
          limit: 3,
        },
      ),
    ).resolves.toBe(0);
    expect(calls.map((call) => call.tableName)).toEqual([
      "projection_set_publication_heads",
      "projection_set_publications",
    ]);
  });

  it.each(["postgres", "tidb"] as const)(
    "proves target historical publication residue with %s JSON/member predicates",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return { rows: [{ id: "publication-with-target" }], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({ executor, kind });

      await expect(hasHistoricalPublicationResidue(database, database, scope)).resolves.toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.sql).toContain("LIMIT 1");
      expect(calls[0]?.sql).toContain(kind === "postgres" ? "jsonb_array_elements" : "JSON_TABLE");
      if (kind === "tidb") {
        expect(calls[0]?.sql.match(/\?/g) ?? []).toHaveLength(calls[0]?.params.length ?? 0);
      }
    },
  );
});
