import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseResearchTaskProgressRepository } from "./research-task-progress-database-repository";

const EVENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f3001";
const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f3002";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f3003";
const TENANT_ID = "tenant-1";
const IDEMPOTENCY_KEY = `research-task-progress:${JOB_ID}:2:research_task.stage_changed`;

describe.each(["postgres", "tidb"] as const)(
  "database Research task progress repository (%s)",
  (dialect) => {
    it("locks the scoped job and appends the next task-local sequence transactionally", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = recordingDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "research_task_jobs") {
          return { rows: [{ id: JOB_ID }], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.params.includes(IDEMPOTENCY_KEY)) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "research_task_progress_events") {
          return { rows: [{ sequence: 4 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createRepository(database.adapter);

      await expect(repository.append(appendInput())).resolves.toEqual({
        createdAt: "2026-07-14T00:00:00.000Z",
        id: EVENT_ID,
        knowledgeSpaceId: SPACE_ID,
        payload: { previousStage: "planning" },
        researchTaskJobId: JOB_ID,
        sequence: 5,
        stage: "retrieving",
        tenantId: TENANT_ID,
        type: "research_task.stage_changed",
      });

      expect(database.transactions).toBe(1);
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "research_task_jobs"],
        ["select", "research_task_progress_events"],
        ["select", "research_task_progress_events"],
        ["insert", "research_task_progress_events"],
      ]);
      expect(calls[0]).toMatchObject({ params: [JOB_ID, TENANT_ID, SPACE_ID] });
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      expect(calls[3]?.params).toEqual([
        EVENT_ID,
        TENANT_ID,
        SPACE_ID,
        JOB_ID,
        5,
        IDEMPOTENCY_KEY,
        "research_task.stage_changed",
        "retrieving",
        JSON.stringify({ previousStage: "planning" }),
        Date.parse("2026-07-14T00:00:00.000Z"),
      ]);
      for (const call of calls) assertPlaceholderArity(call, dialect);
    });

    it("returns an identical idempotent replay without allocating another sequence", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = recordingDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "research_task_jobs") {
          return { rows: [{ id: JOB_ID }], rowsAffected: 0 };
        }
        return input.operation === "select"
          ? { rows: [progressRow()], rowsAffected: 0 }
          : { rows: [], rowsAffected: 1 };
      });
      const repository = createRepository(database.adapter);

      await expect(repository.append(appendInput())).resolves.toMatchObject({
        id: EVENT_ID,
        sequence: 5,
      });
      expect(calls).toHaveLength(2);
      expect(calls.every((call) => call.operation === "select")).toBe(true);

      await expect(
        repository.append({ ...appendInput(), payload: { previousStage: "queued" } }),
      ).rejects.toThrow(/reused with different event data/u);
    });

    it("fails closed when tenant, task, and knowledge-space scope do not resolve together", async () => {
      const database = recordingDatabase(dialect, async () => ({ rows: [], rowsAffected: 0 }));

      await expect(createRepository(database.adapter).append(appendInput())).rejects.toThrow(
        /job scope was not found/u,
      );
      expect(database.calls).toHaveLength(1);
      expect(database.calls[0]?.tableName).toBe("research_task_jobs");
    });
  },
);

it("pages by tenant/task cursor and rejects unbounded reads", async () => {
  const calls: DatabaseExecuteInput[] = [];
  const database = recordingDatabase("postgres", async (input) => {
    calls.push(input);
    return { rows: [progressRow({ sequence: 2 }), progressRow({ sequence: 3 })], rowsAffected: 0 };
  });
  const repository = createRepository(database.adapter, {
    maxListLimit: 1,
    maxPollBatchSize: 1,
  });

  await expect(
    repository.list({ cursor: "1", limit: 1, researchTaskJobId: JOB_ID, tenantId: TENANT_ID }),
  ).resolves.toMatchObject({ items: [{ sequence: 2 }], nextCursor: "2" });
  expect(calls[0]).toMatchObject({ params: [TENANT_ID, JOB_ID, 1, 2] });
  await expect(
    repository.list({ cursor: "01", limit: 1, researchTaskJobId: JOB_ID, tenantId: TENANT_ID }),
  ).rejects.toThrow(/cursor is invalid/u);
  await expect(
    repository.list({ limit: 2, researchTaskJobId: JOB_ID, tenantId: TENANT_ID }),
  ).rejects.toThrow(/between 1 and 1/u);
});

it("polls the durable ledger independently across replicas and releases subscriber bounds", async () => {
  const rows: DatabaseRow[] = [];
  const database = recordingDatabase("postgres", async (input) => {
    if (input.operation !== "select" || input.tableName !== "research_task_progress_events") {
      return { rows: [], rowsAffected: 0 };
    }
    const afterSequence = Number(input.params[2]);
    const limit = Number(input.params[3]);
    return {
      rows: rows.filter((row) => Number(row.sequence) > afterSequence).slice(0, limit),
      rowsAffected: 0,
    };
  });
  const firstReplica = createRepository(database.adapter, { maxSubscribers: 1 });
  const secondReplica = createRepository(database.adapter, { maxSubscribers: 1 });
  const first = firstReplica
    .subscribe({ cursor: "0", researchTaskJobId: JOB_ID, tenantId: TENANT_ID })
    [Symbol.asyncIterator]();
  const second = secondReplica
    .subscribe({ cursor: "0", researchTaskJobId: JOB_ID, tenantId: TENANT_ID })
    [Symbol.asyncIterator]();
  expect(() => firstReplica.subscribe({ researchTaskJobId: JOB_ID, tenantId: TENANT_ID })).toThrow(
    /maxSubscribers=1/u,
  );

  const firstPending = first.next();
  const secondPending = second.next();
  rows.push(progressRow({ sequence: 1 }));

  await expect(Promise.all([firstPending, secondPending])).resolves.toEqual([
    { done: false, value: expect.objectContaining({ sequence: 1 }) },
    { done: false, value: expect.objectContaining({ sequence: 1 }) },
  ]);
  rows.push(progressRow({ sequence: 2 }), progressRow({ sequence: 3 }));
  await expect(Promise.all([first.next(), first.next()])).resolves.toEqual([
    { done: false, value: expect.objectContaining({ sequence: 2 }) },
    { done: false, value: expect.objectContaining({ sequence: 3 }) },
  ]);
  await first.return?.();
  await second.return?.();

  const replacement = firstReplica
    .subscribe({ cursor: "1", researchTaskJobId: JOB_ID, tenantId: TENANT_ID })
    [Symbol.asyncIterator]();
  await replacement.return?.();
});

it("validates polling bounds during construction", () => {
  const database = recordingDatabase("postgres", async () => ({ rows: [], rowsAffected: 0 }));
  expect(() => createRepository(database.adapter, { maxPollBatchSize: 101 })).toThrow(
    /must not exceed maxListLimit/u,
  );
  expect(() => createRepository(database.adapter, { pollIntervalMs: 1 })).toThrow(
    /between 10 and 60000/u,
  );
});

function createRepository(
  database: DatabaseAdapter,
  overrides: Partial<Parameters<typeof createDatabaseResearchTaskProgressRepository>[0]> = {},
) {
  return createDatabaseResearchTaskProgressRepository({
    database,
    generateId: () => EVENT_ID,
    maxListLimit: 100,
    maxPollBatchSize: 10,
    maxSubscribers: 10,
    now: () => Date.parse("2026-07-14T00:00:00.000Z"),
    pollIntervalMs: 10,
    ...overrides,
  });
}

function appendInput() {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    knowledgeSpaceId: SPACE_ID,
    payload: { previousStage: "planning" },
    researchTaskJobId: JOB_ID,
    stage: "retrieving" as const,
    tenantId: TENANT_ID,
    type: "research_task.stage_changed" as const,
  };
}

function progressRow(overrides: Partial<DatabaseRow> = {}): DatabaseRow {
  return {
    created_at: Date.parse("2026-07-14T00:00:00.000Z"),
    event_type: "research_task.stage_changed",
    id: EVENT_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    knowledge_space_id: SPACE_ID,
    payload: JSON.stringify({ previousStage: "planning" }),
    research_task_job_id: JOB_ID,
    sequence: 5,
    stage: "retrieving",
    tenant_id: TENANT_ID,
    ...overrides,
  };
}

function recordingDatabase(
  dialect: "postgres" | "tidb",
  executeInput: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
) {
  const calls: DatabaseExecuteInput[] = [];
  let transactions = 0;
  const execute = async (input: DatabaseExecuteInput) => {
    calls.push(input);
    return executeInput(input);
  };
  const adapter = {
    dialect,
    execute,
    kind: dialect,
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => {
      transactions += 1;
      return callback({ execute });
    },
  } as unknown as DatabaseAdapter;
  return {
    adapter,
    calls,
    get transactions() {
      return transactions;
    },
  };
}

function assertPlaceholderArity(call: DatabaseExecuteInput, dialect: "postgres" | "tidb"): void {
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}
