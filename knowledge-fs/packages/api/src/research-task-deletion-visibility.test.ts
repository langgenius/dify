import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseResearchTaskDeletionVisibility } from "./research-task-deletion-visibility";

describe("Research public deletion visibility", () => {
  it.each(["postgres", "tidb"] as const)(
    "hides Research history only for active knowledge-space deletion (%s)",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return {
          rows: [{ id: "deletion-1", target_type: "knowledge_space" }],
          rowsAffected: 0,
        };
      };
      const database = createSchemaDatabaseAdapter({ executor, kind });

      await expect(
        createDatabaseResearchTaskDeletionVisibility(database).isSpaceReadable({
          knowledgeSpaceId: "space-1",
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(false);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.sql).toContain("active_slot");
      expect(calls[0]?.sql).toContain("target_type");
      expect(calls[0]?.sql).toContain("knowledge_space");
      expect(calls[0]?.sql).not.toContain("delete_mode");
      expect(calls[0]?.params).toEqual(["tenant-1", "space-1"]);
      if (kind === "tidb") {
        expect(calls[0]?.sql.match(/\?/g) ?? []).toHaveLength(calls[0]?.params.length ?? 0);
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "keeps Research history readable during subresource deletion (%s)",
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
      expect(calls[0]?.sql).toContain("target_type");
      expect(calls[0]?.sql).toContain("knowledge_space");
      if (kind === "tidb") {
        expect(calls[0]?.sql.match(/\?/g) ?? []).toHaveLength(calls[0]?.params.length ?? 0);
      }
    },
  );
});
