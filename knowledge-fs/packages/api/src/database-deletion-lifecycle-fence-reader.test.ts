import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseDeletionLifecycleFenceReader } from "./database-deletion-lifecycle-fence-reader";

describe.each(["postgres", "tidb"] as const)(
  "database deletion lifecycle fence reader (%s)",
  (dialect) => {
    it("queries the exact tenant/space hierarchy and gives the space tombstone precedence", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push({ ...input, params: [...input.params] });
          return {
            rows: [
              {
                id: "tombstone-space",
                knowledge_space_id: "space-1",
                state: "completed",
                target_id: "space-1",
                target_type: "knowledge_space",
                tenant_id: "tenant-1",
              },
            ],
            rowsAffected: 1,
          };
        },
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const reader = createDatabaseDeletionLifecycleFenceReader(database);

      await expect(
        reader.getActiveFence({
          documentAssetId: "document-1",
          knowledgeSpaceId: "space-1",
          sourceId: "source-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toEqual({
        id: "tombstone-space",
        knowledgeSpaceId: "space-1",
        targetId: "space-1",
        targetType: "space",
        tenantId: "tenant-1",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        maxRows: 1,
        operation: "select",
        params: ["tenant-1", "space-1", "source-1", "document-1"],
        tableName: "deletion_tombstones",
      });
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? '"tenant_id" = $1' : "`tenant_id` = ?",
      );
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? '"knowledge_space_id" = $2' : "`knowledge_space_id` = ?",
      );
      expect(calls[0]?.sql).toContain("'knowledge_space'");
      expect(calls[0]?.sql).toContain("'source'");
      expect(calls[0]?.sql).toContain("'document_asset'");
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? 'FROM "document_assets"' : "FROM `document_assets`",
      );
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? 'source_document."source_id"' : "source_document.`source_id`",
      );
      expect(calls[0]?.sql).not.toContain("state");
      expect(calls[0]?.sql).toContain("deletion_jobs");
      expect(calls[0]?.sql).toContain("active_slot");
      expect(calls[0]?.sql).toContain("CASE");
    });

    it("binds absent child targets as null and maps source/document tombstones", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const rows = [
        {
          id: "tombstone-source",
          knowledge_space_id: "space-1",
          target_id: "source-1",
          target_type: "source",
          tenant_id: "tenant-1",
        },
        {
          id: "tombstone-document",
          knowledge_space_id: "space-1",
          target_id: "document-1",
          target_type: "document_asset",
          tenant_id: "tenant-1",
        },
      ];
      let rowIndex = 0;
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push({ ...input, params: [...input.params] });
          return { rows: [rows[rowIndex++] ?? {}], rowsAffected: 1 };
        },
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const reader = createDatabaseDeletionLifecycleFenceReader(database);

      await expect(
        reader.getActiveFence({
          knowledgeSpaceId: "space-1",
          sourceId: "source-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ targetId: "source-1", targetType: "source" });
      await expect(
        reader.getActiveFence({
          documentAssetId: "document-1",
          knowledgeSpaceId: "space-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ targetId: "document-1", targetType: "document" });
      expect(calls.map((call) => call.params)).toEqual([
        ["tenant-1", "space-1", "source-1", null],
        ["tenant-1", "space-1", null, "document-1"],
      ]);
    });

    it("returns null without a matching exact tombstone", async () => {
      const database = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const reader = createDatabaseDeletionLifecycleFenceReader(database);
      await expect(
        reader.getActiveFence({ knowledgeSpaceId: "space-1", tenantId: "tenant-1" }),
      ).resolves.toBeNull();
    });
  },
);
