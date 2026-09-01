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
          documentId: "logical-document-1",
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
        tableName: "deletion_tombstones",
      });
      if (dialect === "postgres") {
        expect(calls[0]?.params).toEqual([
          "tenant-1",
          "space-1",
          "source-1",
          "logical-document-1",
          "document-1",
        ]);
      } else {
        expect(calls[0]?.params.slice(0, 2)).toEqual(["tenant-1", "space-1"]);
        expect(calls[0]?.params).toEqual(
          expect.arrayContaining(["source-1", "logical-document-1", "document-1"]),
        );
      }
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? '"tenant_id" = $1' : "`tenant_id` = ?",
      );
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? '"knowledge_space_id" = $2' : "`knowledge_space_id` = ?",
      );
      if (dialect === "postgres") {
        expect(calls[0]?.sql).toContain("$3::uuid IS NOT NULL");
        expect(calls[0]?.sql).toContain("$4::uuid IS NOT NULL");
        expect(calls[0]?.sql).toContain("$5::uuid IS NOT NULL");
        expect(calls[0]?.sql.match(/\(/gu)).toHaveLength(calls[0]?.sql.match(/\)/gu)?.length ?? 0);
      }
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
      expect(calls[0]?.sql).not.toContain("<> 'source'");
      expect(calls[0]?.sql).toContain("logical_documents");
      expect(calls[0]?.sql).toContain("document_revisions");
      expect(calls[0]?.sql).toContain("CASE");
      assertSqlPlaceholderArity(calls[0], dialect);
    });

    it("keeps active Source deletion fences scoped to the requested Source", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const deletingSourceId = "20000000-0000-4000-8000-000000000002";
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push({ ...input, params: [...input.params] });
          return input.params.includes(deletingSourceId)
            ? {
                rows: [
                  {
                    id: "active-source-deletion",
                    knowledge_space_id: "space-1",
                    target_id: deletingSourceId,
                    target_type: "source",
                    tenant_id: "tenant-1",
                  },
                ],
                rowsAffected: 1,
              }
            : { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const reader = createDatabaseDeletionLifecycleFenceReader(database);

      await expect(
        reader.getActiveFence({
          knowledgeSpaceId: "space-1",
          sourceId: "20000000-0000-4000-8000-000000000001",
          tenantId: "tenant-1",
        }),
      ).resolves.toBeNull();
      await expect(
        reader.getActiveFence({
          knowledgeSpaceId: "space-1",
          sourceId: deletingSourceId,
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ targetId: deletingSourceId, targetType: "source" });
      expect(calls).toHaveLength(2);
      for (const call of calls) assertSqlPlaceholderArity(call, dialect);
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
      if (dialect === "postgres") {
        expect(calls.map((call) => call.params)).toEqual([
          ["tenant-1", "space-1", "source-1", null, null],
          ["tenant-1", "space-1", null, null, "document-1"],
        ]);
      } else {
        expect(calls[0]?.params).toContain("source-1");
        expect(calls[1]?.params).toContain("document-1");
        for (const call of calls) assertSqlPlaceholderArity(call, dialect);
      }
    });

    it("scopes active logical-document and asset deletion fences to matching targets", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push({ ...input, params: [...input.params] });
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const reader = createDatabaseDeletionLifecycleFenceReader(database);

      await expect(
        reader.getActiveFence({
          documentAssetId: "asset-b",
          documentId: "document-b",
          knowledgeSpaceId: "space-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toBeNull();
      const sql = calls[0]?.sql ?? "";
      if (dialect === "postgres") {
        expect(calls[0]?.params).toEqual(["tenant-1", "space-1", null, "document-b", "asset-b"]);
      } else {
        expect(calls[0]?.params.slice(0, 2)).toEqual(["tenant-1", "space-1"]);
        expect(calls[0]?.params).toEqual(expect.arrayContaining(["document-b", "asset-b"]));
      }
      expect(sql).toContain("'logical_document'");
      expect(sql).toContain("'document_asset'");
      expect(sql).toContain(dialect === "postgres" ? "$4::uuid" : "?");
      expect(sql).toContain(dialect === "postgres" ? "$5::uuid" : "?");
      assertSqlPlaceholderArity(calls[0], dialect);
    });

    it("returns null without a matching exact tombstone", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const reader = createDatabaseDeletionLifecycleFenceReader(database);
      await expect(
        reader.getActiveFence({ knowledgeSpaceId: "space-1", tenantId: "tenant-1" }),
      ).resolves.toBeNull();
      if (dialect === "postgres") {
        expect(calls[0]?.params).toEqual(["tenant-1", "space-1", null, null, null]);
      } else {
        expect(calls[0]?.params.slice(0, 2)).toEqual(["tenant-1", "space-1"]);
        expect(calls[0]?.params).toContain(null);
      }
      expect(calls[0]?.sql).toContain("'knowledge_space'");
      expect(calls[0]?.sql).toContain("'source'");
      expect(calls[0]?.sql).toContain("'logical_document'");
      expect(calls[0]?.sql).toContain("'document_asset'");
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? "$3::uuid IS NOT NULL" : "? IS NOT NULL",
      );
      assertSqlPlaceholderArity(calls[0], dialect);
    });
  },
);

function assertSqlPlaceholderArity(
  call: DatabaseExecuteInput | undefined,
  dialect: "postgres" | "tidb",
): void {
  expect(call).toBeDefined();
  if (!call) return;
  assertSqlParenthesesBalanced(call.sql);
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}

function assertSqlParenthesesBalanced(sql: string): void {
  let depth = 0;
  for (const character of sql) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);
}
