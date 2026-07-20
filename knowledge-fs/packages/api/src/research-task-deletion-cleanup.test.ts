import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  deleteResearchTaskSpaceResiduePage,
  deleteResearchTaskSpaceResiduePageWithExecutor,
  hasResearchTaskSpaceResidue,
} from "./research-task-deletion-cleanup";

const scope = {
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  tenantId: "tenant-1",
} as const;

describe("Research durable-deletion cleanup", () => {
  it.each(["postgres", "tidb"] as const)(
    "physically invalidates completed jobs and every readable child ledger in %s",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "research_task_jobs") {
          return {
            rows: [
              { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80" },
              { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81" },
            ],
            rowsAffected: 2,
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
        deleteResearchTaskSpaceResiduePage(database, { ...scope, limit: 2 }),
      ).resolves.toBe(2);
      expect(
        calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
      ).toEqual([
        "research_task_outbox",
        "research_task_partial_results",
        "research_task_progress_events",
        "research_task_jobs",
      ]);
      const jobDelete = calls.at(-1);
      expect(jobDelete?.sql).toContain("tenant_id");
      expect(jobDelete?.sql).toContain("knowledge_space_id");
      expect(jobDelete?.params).toEqual([
        scope.tenantId,
        scope.knowledgeSpaceId,
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
      ]);
      if (kind === "tidb") {
        for (const call of calls) {
          expect(call.sql.match(/\?/g) ?? []).toHaveLength(call.params.length);
        }
      }
    },
  );

  it("scrubs tenant-attributable orphan partials after all jobs are gone", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.operation === "select" && input.tableName === "research_task_partial_results") {
        return {
          rows: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c90" }],
          rowsAffected: 1,
        };
      }
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });

    await expect(
      deleteResearchTaskSpaceResiduePage(database, { ...scope, limit: 5 }),
    ).resolves.toBe(1);
    expect(calls.at(-1)?.tableName).toBe("research_task_partial_results");
    expect(calls.at(-1)?.operation).toBe("delete");
  });

  it("proves completed job/progress/partial residue independently", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return {
        rows: input.tableName === "research_task_progress_events" ? [{ id: "residue" }] : [],
        rowsAffected: 0,
      };
    };
    const database = createSchemaDatabaseAdapter({ executor, kind: "postgres" });

    await expect(hasResearchTaskSpaceResidue(database, database, scope)).resolves.toBe(true);
    expect(calls.map((call) => call.tableName)).toEqual([
      "research_task_jobs",
      "research_task_partial_results",
      "research_task_progress_events",
    ]);
  });

  it.each(["postgres", "tidb"] as const)(
    "boundedly removes globally safe orphan outbox rows without relying on FK enforcement in %s",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "research_task_outbox") {
          return {
            rows: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99" }],
            rowsAffected: 1,
          };
        }
        return { rows: [], rowsAffected: input.operation === "delete" ? 1 : 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async () => {
          throw new Error("nested transaction must not be opened");
        },
      });

      await expect(
        deleteResearchTaskSpaceResiduePageWithExecutor(
          database,
          { execute: executor },
          {
            ...scope,
            limit: 7,
          },
        ),
      ).resolves.toBe(1);

      const outboxCalls = calls.filter((call) => call.tableName === "research_task_outbox");
      expect(outboxCalls).toHaveLength(2);
      expect(outboxCalls[0]?.operation).toBe("select");
      expect(outboxCalls[0]?.sql).toContain("NOT EXISTS");
      expect(outboxCalls[0]?.sql).toContain("research_task_jobs");
      expect(outboxCalls[0]?.params).toEqual([7]);
      expect(outboxCalls[1]?.operation).toBe("delete");
      expect(outboxCalls[1]?.params).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"]);
      if (kind === "tidb") {
        for (const call of calls) {
          expect(call.sql.match(/\?/g) ?? []).toHaveLength(call.params.length);
        }
      }
    },
  );

  it("includes orphan outbox rows in completion proof after scoped jobs are gone", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return {
        rows: input.tableName === "research_task_outbox" ? [{ id: "orphan" }] : [],
        rowsAffected: 0,
      };
    };
    const database = createSchemaDatabaseAdapter({ executor, kind: "postgres" });

    await expect(hasResearchTaskSpaceResidue(database, database, scope)).resolves.toBe(true);
    expect(calls.map((call) => call.tableName)).toEqual([
      "research_task_jobs",
      "research_task_partial_results",
      "research_task_progress_events",
      "research_task_outbox",
    ]);
    expect(calls.at(-1)?.sql).toContain("NOT EXISTS");
    expect(calls.at(-1)?.params).toEqual([]);
  });
});
