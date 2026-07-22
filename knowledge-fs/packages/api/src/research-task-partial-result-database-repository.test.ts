import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseResearchTaskPartialResultRepository } from "./research-task-partial-result-database-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const researchTaskJobId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const now = Date.parse("2026-07-14T12:00:00.000Z");

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows: readonly DatabaseRow[];
  readonly tableName: string;
}

describe.each(["postgres", "tidb"] as const)(
  "database research task partial results (%s)",
  (dialect) => {
    it("appends monotonically, replays idempotently, and rejects a missing job scope", async () => {
      const firstScript = scriptedDatabase(dialect, [
        step("research_task_jobs", "select", [{ id: researchTaskJobId }]),
        step("research_task_partial_results", "select", []),
        step("research_task_partial_results", "select", []),
        step("research_task_partial_results", "insert", []),
      ]);
      const firstRepository = createDatabaseResearchTaskPartialResultRepository({
        database: firstScript.database,
        generateId: () => "partial-row-1",
        maxListLimit: 10,
        now: () => now,
      });

      await expect(
        firstRepository.append({
          evidenceBundle: evidenceBundle("bundle-1"),
          idempotencyKey: "partial-step-1",
          knowledgeSpaceId,
          researchTaskJobId,
          tenantId,
        }),
      ).resolves.toMatchObject({
        evidenceBundle: { id: evidenceBundle("bundle-1").id },
        knowledgeSpaceId,
        researchTaskJobId,
        sequence: 1,
        tenantId,
      });
      const insert = firstScript.calls.at(-1);
      expect(insert?.params).toEqual([
        "partial-row-1",
        tenantId,
        knowledgeSpaceId,
        researchTaskJobId,
        1,
        "partial-step-1",
        JSON.stringify(evidenceBundle("bundle-1")),
        now,
      ]);
      expect(insert?.sql).toContain(dialect === "postgres" ? "::jsonb" : " AS JSON");
      firstScript.expectDone();

      const secondScript = scriptedDatabase(dialect, [
        step("research_task_jobs", "select", [{ id: researchTaskJobId }]),
        step("research_task_partial_results", "select", []),
        step("research_task_partial_results", "select", [{ sequence: 1 }]),
        step("research_task_partial_results", "insert", []),
      ]);
      const generatedIds = ["idempotency-id", "partial-row-2"];
      const secondRepository = createDatabaseResearchTaskPartialResultRepository({
        database: secondScript.database,
        generateId: () => generatedIds.shift() ?? "unexpected-id",
        maxListLimit: 10,
        now: () => now,
      });
      await expect(
        secondRepository.append({
          evidenceBundle: evidenceBundle("bundle-2"),
          knowledgeSpaceId,
          researchTaskJobId,
          tenantId,
        }),
      ).resolves.toMatchObject({ sequence: 2 });
      expect(secondScript.calls.at(-1)?.params.slice(0, 6)).toEqual([
        "partial-row-2",
        tenantId,
        knowledgeSpaceId,
        researchTaskJobId,
        2,
        `partial:idempotency-id:${researchTaskJobId}`,
      ]);
      secondScript.expectDone();

      const replayRow = partialRow({ sequence: 7 });
      const replayScript = scriptedDatabase(dialect, [
        step("research_task_jobs", "select", [{ id: researchTaskJobId }]),
        step("research_task_partial_results", "select", [replayRow]),
      ]);
      const replayRepository = createDatabaseResearchTaskPartialResultRepository({
        database: replayScript.database,
        maxListLimit: 10,
      });
      await expect(
        replayRepository.append({
          evidenceBundle: evidenceBundle("ignored-on-replay"),
          idempotencyKey: "partial-step-1",
          knowledgeSpaceId,
          researchTaskJobId,
          tenantId,
        }),
      ).resolves.toEqual({
        evidenceBundle: evidenceBundle("bundle-7"),
        knowledgeSpaceId,
        researchTaskJobId,
        sequence: 7,
        tenantId,
      });
      replayScript.expectDone();

      const missingScopeScript = scriptedDatabase(dialect, [
        step("research_task_jobs", "select", []),
      ]);
      const missingScopeRepository = createDatabaseResearchTaskPartialResultRepository({
        database: missingScopeScript.database,
        maxListLimit: 10,
      });
      await expect(
        missingScopeRepository.append({
          evidenceBundle: evidenceBundle("bundle-missing"),
          knowledgeSpaceId,
          researchTaskJobId,
          tenantId,
        }),
      ).rejects.toThrow("job scope was not found");
      missingScopeScript.expectDone();
    });

    it("paginates by sequence and validates every externally supplied bound", async () => {
      const script = scriptedDatabase(dialect, [
        step("research_task_partial_results", "select", [
          partialRow({ sequence: 1 }),
          partialRow({ sequence: 2 }),
          partialRow({ sequence: 3 }),
        ]),
        step("research_task_partial_results", "select", [partialRow({ sequence: 3 })]),
      ]);
      const repository = createDatabaseResearchTaskPartialResultRepository({
        database: script.database,
        maxListLimit: 2,
      });

      const first = await repository.list({ limit: 2, researchTaskJobId, tenantId });
      expect(first).toMatchObject({
        items: [{ sequence: 1 }, { sequence: 2 }],
        nextCursor: "2",
      });
      expect(script.calls[0]?.params).toEqual([tenantId, researchTaskJobId, 0, 3]);
      await expect(
        repository.list({ cursor: first.nextCursor, limit: 2, researchTaskJobId, tenantId }),
      ).resolves.toMatchObject({ items: [{ sequence: 3 }] });
      expect(script.calls[1]?.params).toEqual([tenantId, researchTaskJobId, 2, 3]);
      script.expectDone();

      expect(() =>
        createDatabaseResearchTaskPartialResultRepository({
          database: script.database,
          maxListLimit: 0,
        }),
      ).toThrow("positive integer");
      const invalidOperations = [
        () =>
          repository.append({
            evidenceBundle: evidenceBundle("invalid"),
            knowledgeSpaceId,
            researchTaskJobId,
            tenantId: " ",
          }),
        () =>
          repository.append({
            evidenceBundle: evidenceBundle("invalid"),
            idempotencyKey: " ",
            knowledgeSpaceId,
            researchTaskJobId,
            tenantId,
          }),
        () => repository.list({ limit: 0, researchTaskJobId, tenantId }),
        () => repository.list({ limit: 3, researchTaskJobId, tenantId }),
        () => repository.list({ cursor: "01", limit: 1, researchTaskJobId, tenantId }),
        () => repository.list({ cursor: "-1", limit: 1, researchTaskJobId, tenantId }),
      ];
      for (const operation of invalidOperations) await expect(operation()).rejects.toThrow();
    });
  },
);

function evidenceBundle(id: string) {
  const suffix = (id.match(/\d+/u)?.[0] ?? "99").padStart(12, "0").slice(-12);
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    id: `018f0d60-7a49-7cc2-9c1b-${suffix}`,
    items: [],
    missingEvidence: [],
    query: "partial research answer",
    state: "partial" as const,
  };
}

function partialRow(overrides: Partial<DatabaseRow> = {}): DatabaseRow {
  const sequence = typeof overrides.sequence === "number" ? overrides.sequence : 1;
  return {
    evidence_bundle: evidenceBundle(`bundle-${sequence}`),
    knowledge_space_id: knowledgeSpaceId,
    research_task_job_id: researchTaskJobId,
    sequence,
    tenant_id: tenantId,
    ...overrides,
  };
}

function scriptedDatabase(
  dialect: DatabaseAdapter["dialect"],
  steps: readonly ScriptStep[],
): {
  readonly calls: readonly DatabaseExecuteInput[];
  readonly database: DatabaseAdapter;
  expectDone(): void;
} {
  let cursor = 0;
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    const expected = steps[cursor];
    if (!expected) throw new Error(`Unexpected SQL call ${input.operation} ${input.tableName}`);
    cursor += 1;
    expect(input).toMatchObject({ operation: expected.operation, tableName: expected.tableName });
    return {
      rows: expected.rows,
      rowsAffected: input.operation === "select" ? 0 : 1,
    };
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>): Promise<T> =>
    callback({ execute });
  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}

function step(
  tableName: string,
  operation: DatabaseExecuteInput["operation"],
  rows: readonly DatabaseRow[],
): ScriptStep {
  return { operation, rows, tableName };
}
