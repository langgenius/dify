import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseResearchTaskDeletionVisibility } from "./research-task-deletion-visibility";

describe("Research public deletion visibility", () => {
  it.each([
    ["document_asset", "cascade"],
    ["source", "keep_documents"],
    ["source", "cascade"],
    ["knowledge_space", "cascade"],
  ] as const)(
    "hides the whole space for active %s/%s deletion without filtering target type or mode",
    async (targetType, deleteMode) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return {
          rows: [{ delete_mode: deleteMode, id: "deletion-1", target_type: targetType }],
          rowsAffected: 0,
        };
      };
      const database = createSchemaDatabaseAdapter({ executor, kind: "postgres" });

      await expect(
        createDatabaseResearchTaskDeletionVisibility(database).isSpaceReadable({
          knowledgeSpaceId: "space-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(false);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.sql).toContain("active_slot");
      expect(calls[0]?.sql).not.toContain("target_type");
      expect(calls[0]?.sql).not.toContain("delete_mode");
      expect(calls[0]?.params).toEqual(["tenant-1", "space-1"]);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "keeps the space readable when %s has no active deletion",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({ executor, kind });

      await expect(
        createDatabaseResearchTaskDeletionVisibility(database).isSpaceReadable({
          knowledgeSpaceId: "space-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(true);
      if (kind === "tidb") {
        expect(calls[0]?.sql.match(/\?/g) ?? []).toHaveLength(calls[0]?.params.length ?? 0);
      }
    },
  );
});
