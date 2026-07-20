import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseResearchTaskDurableRepository } from "./research-task-durable-repository";
import type { ResearchTaskJob } from "./research-task-job";

const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02";
const SNAPSHOT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03";
const OUTBOX_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e04";
const PROGRESS_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e05";
const QUEUE_JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e06";
const LEASE_TOKEN = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e07";

describe.each(["postgres", "tidb"] as const)(
  "database research task durable repository (%s)",
  (dialect) => {
    it("atomically stores the complete job while the outbox payload contains only jobId", async () => {
      const fake = new RecordingDatabase(dialect);
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateOutboxId: () => OUTBOX_ID,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(repository.start(job())).resolves.toMatchObject({
        id: JOB_ID,
        mode: "deep",
        topK: 7,
      });

      expect(fake.transactions).toBe(1);
      expect(fake.commits).toBe(1);
      expect(fake.calls).toHaveLength(6);
      expect(fake.calls[0]).toMatchObject({ operation: "select", tableName: "knowledge_spaces" });
      expect(fake.calls[0]?.sql).toContain("FOR UPDATE");
      expect(fake.calls[0]?.sql).toContain("lifecycle_state");
      expect(fake.calls[0]?.sql).toContain("deletion_job_id");
      expect(fake.calls[1]).toMatchObject({ operation: "insert", tableName: "research_task_jobs" });
      expect(fake.calls[1]?.params).toContain("Compare durable ACL behavior");
      const outboxInsert = fake.calls[2];
      expect(outboxInsert).toMatchObject({
        operation: "insert",
        tableName: "research_task_outbox",
      });
      const payload = JSON.parse(String(outboxInsert?.params[6])) as Record<string, unknown>;
      expect(payload).toEqual({ researchTaskJobId: JOB_ID });
      expect(JSON.stringify(payload)).not.toContain("query");
      expect(JSON.stringify(payload)).not.toContain("permissionScope");
      expect(JSON.stringify(payload)).not.toContain("server:grant");

      expect(fake.calls.slice(3).map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "research_task_progress_events"],
        ["select", "research_task_progress_events"],
        ["insert", "research_task_progress_events"],
      ]);
      expect(fake.calls[5]?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        1,
        `research-task-progress:${JOB_ID}:1:research_task.started`,
        "research_task.started",
        "queued",
        "{}",
        1_000,
      ]);

      for (const call of fake.calls) {
        if (dialect === "tidb") {
          expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
        } else {
          const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
          expect(Math.max(...positions)).toBe(call.params.length);
        }
      }
    });

    it("fails closed when durable deletion becomes active before job insertion", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "insert") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({ database: fake.adapter });

      await expect(repository.start(job())).rejects.toThrow(
        "Research task creation rejected by active durable deletion",
      );

      expect(fake.transactions).toBe(1);
      expect(fake.commits).toBe(0);
      expect(fake.rollbacks).toBe(1);
      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[0]).toMatchObject({
        operation: "select",
        tableName: "knowledge_spaces",
      });
      expect(fake.calls[0]?.sql).toContain("FOR UPDATE");
      expect(fake.calls[1]).toMatchObject({
        operation: "insert",
        tableName: "research_task_jobs",
      });
      expect(fake.calls[1]?.sql).toContain("deletion_jobs");
      expect(fake.calls[1]?.sql).toContain("active_slot");
      expect(fake.calls[1]?.sql).toContain("NOT EXISTS");
      expect(fake.calls[1]?.sql).not.toContain("Compare durable ACL behavior");
      assertPlaceholderArity(fake.calls[1] as DatabaseExecuteInput, dialect);
    });

    it("rolls back the job/outbox transaction when the progress append fails", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_progress_events" && input.operation === "insert") {
          throw new Error("progress ledger unavailable");
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateOutboxId: () => OUTBOX_ID,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(repository.start(job())).rejects.toThrow("progress ledger unavailable");

      expect(fake.transactions).toBe(1);
      expect(fake.commits).toBe(0);
      expect(fake.rollbacks).toBe(1);
      expect(fake.calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "knowledge_spaces"],
        ["insert", "research_task_jobs"],
        ["insert", "research_task_outbox"],
        ["select", "research_task_progress_events"],
        ["select", "research_task_progress_events"],
        ["insert", "research_task_progress_events"],
      ]);
    });

    it("locks and rejects an unavailable knowledge space before writing a job", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => ({
        rows: [],
        rowsAffected: input.tableName === "knowledge_spaces" ? 0 : 1,
      }));
      const repository = createDatabaseResearchTaskDurableRepository({ database: fake.adapter });

      await expect(repository.start(job())).rejects.toThrow(
        "Research task creation rejected because knowledge space is unavailable",
      );
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]).toMatchObject({
        operation: "select",
        tableName: "knowledge_spaces",
      });
      expect(fake.calls[0]?.sql).toContain("FOR UPDATE");
      expect(fake.calls[0]?.params).toEqual(["tenant-1", SPACE_ID]);
      expect(fake.rollbacks).toBe(1);
      expect(fake.commits).toBe(0);
      assertPlaceholderArity(fake.calls[0] as DatabaseExecuteInput, dialect);
    });

    it("rolls back an already-issued job update when its progress append fails", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return { rows: [jobRow()], rowsAffected: 0 };
        }
        if (input.tableName === "research_task_progress_events" && input.operation === "insert") {
          throw new Error("progress insert rejected");
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.update({ ...job(), stage: "planning", updatedAt: 2_000 }),
      ).rejects.toThrow("progress insert rejected");

      expect(fake.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: "update", tableName: "research_task_jobs" }),
          expect.objectContaining({
            operation: "insert",
            tableName: "research_task_progress_events",
          }),
        ]),
      );
      expect(fake.commits).toBe(0);
      expect(fake.rollbacks).toBe(1);
    });

    it("commits a visible stage transition and its ordered progress event together", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return { rows: [jobRow()], rowsAffected: 0 };
        }
        if (
          input.tableName === "research_task_progress_events" &&
          input.operation === "select" &&
          input.params.length === 1
        ) {
          return { rows: [{ sequence: 1 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.update({ ...job(), stage: "planning", updatedAt: 2_000 }),
      ).resolves.toMatchObject({ rowVersion: 2, stage: "planning" });

      expect(fake.transactions).toBe(1);
      expect(fake.commits).toBe(1);
      const jobUpdateIndex = fake.calls.findIndex(
        (call) => call.tableName === "research_task_jobs" && call.operation === "update",
      );
      const progressInsertIndex = fake.calls.findIndex(
        (call) => call.tableName === "research_task_progress_events" && call.operation === "insert",
      );
      expect(jobUpdateIndex).toBeGreaterThan(-1);
      expect(progressInsertIndex).toBeGreaterThan(jobUpdateIndex);
      expect(fake.calls[progressInsertIndex]?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        2,
        `research-task-progress:${JOB_ID}:2:research_task.stage_changed`,
        "research_task.stage_changed",
        "planning",
        JSON.stringify({ previousStage: "queued" }),
        2_000,
      ]);
      for (const call of fake.calls) assertPlaceholderArity(call, dialect);
    });

    it("maps pause, cancel, and failure mutations to durable progress types", async () => {
      const scenarios = [
        {
          expectedPayload: { reason: "Backpressure" },
          expectedType: "research_task.paused",
          update: {
            error: "Backpressure",
            pausedAt: 2_000,
            pausedFromStage: "queued" as const,
            stage: "paused" as const,
          },
        },
        {
          expectedPayload: { reason: "Canceled by user" },
          expectedType: "research_task.canceled",
          update: {
            completedAt: 2_000,
            error: "Canceled by user",
            stage: "canceled" as const,
          },
        },
        {
          expectedPayload: { error: "Provider unavailable" },
          expectedType: "research_task.failed",
          update: {
            completedAt: 2_000,
            error: "Provider unavailable",
            stage: "failed" as const,
          },
        },
      ] as const;

      for (const scenario of scenarios) {
        const fake = new RecordingDatabase(dialect, async (input) => {
          if (input.tableName === "research_task_jobs" && input.operation === "select") {
            return { rows: [jobRow()], rowsAffected: 0 };
          }
          return { rows: [], rowsAffected: 1 };
        });
        const repository = createDatabaseResearchTaskDurableRepository({
          database: fake.adapter,
          generateProgressEventId: () => PROGRESS_ID,
        });

        await repository.update({ ...job(), ...scenario.update, updatedAt: 2_000 });

        const progressInsert = fake.calls.find(
          (call) =>
            call.tableName === "research_task_progress_events" && call.operation === "insert",
        );
        expect(progressInsert?.params).toMatchObject([
          PROGRESS_ID,
          "tenant-1",
          SPACE_ID,
          JOB_ID,
          1,
          `research-task-progress:${JOB_ID}:2:${scenario.expectedType}`,
          scenario.expectedType,
          scenario.update.stage,
          JSON.stringify(scenario.expectedPayload),
          2_000,
        ]);
        expect(fake.commits).toBe(1);
        for (const call of fake.calls) assertPlaceholderArity(call, dialect);
      }
    });

    it("atomically resumes a paused task, replaces its delivery, and appends progress", async () => {
      const paused = {
        ...job(),
        error: "Backpressure",
        pausedAt: 1_500,
        pausedFromStage: "planning" as const,
        stage: "paused" as const,
      };
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return {
            rows: [
              jobRow({
                error: paused.error,
                paused_at: paused.pausedAt,
                paused_from_stage: paused.pausedFromStage,
                stage: paused.stage,
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "research_task_outbox" &&
          input.operation === "select" &&
          input.sql.includes("delivery_revision")
        ) {
          return { rows: [{ delivery_revision: 1 }], rowsAffected: 0 };
        }
        if (
          input.tableName === "research_task_progress_events" &&
          input.operation === "select" &&
          input.params.length === 1
        ) {
          return { rows: [{ sequence: 3 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateOutboxId: () => OUTBOX_ID,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.requestResume({ job: paused, resumeFromStage: "planning", updatedAt: 2_000 }),
      ).resolves.toMatchObject({ rowVersion: 2, stage: "planning" });

      const progressInsert = fake.calls.find(
        (call) => call.tableName === "research_task_progress_events" && call.operation === "insert",
      );
      expect(progressInsert?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        4,
        `research-task-progress:${JOB_ID}:2:research_task.resumed`,
        "research_task.resumed",
        "planning",
        JSON.stringify({ resumedFrom: "paused" }),
        2_000,
      ]);
      expect(fake.calls.filter((call) => call.tableName === "research_task_outbox")).toHaveLength(
        3,
      );
      expect(fake.commits).toBe(1);
      for (const call of fake.calls) assertPlaceholderArity(call, dialect);
    });

    it("atomically records an execution claim with a task-local sequence", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return { rows: [jobRow({ queue_job_id: QUEUE_JOB_ID })], rowsAffected: 0 };
        }
        if (
          input.tableName === "research_task_progress_events" &&
          input.operation === "select" &&
          input.params.length === 1
        ) {
          return { rows: [{ sequence: 2 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.claimExecution({
          expectedRowVersion: 1,
          leaseExpiresAt: 5_000,
          leaseToken: LEASE_TOKEN,
          now: 2_000,
          queueJobId: QUEUE_JOB_ID,
          researchTaskJobId: JOB_ID,
          workerId: "worker-1",
        }),
      ).resolves.toMatchObject({
        executionAttempts: 1,
        leaseToken: LEASE_TOKEN,
        rowVersion: 2,
      });

      expect(fake.transactions).toBe(1);
      expect(fake.commits).toBe(1);
      const progressInsert = fake.calls.find(
        (call) => call.tableName === "research_task_progress_events" && call.operation === "insert",
      );
      expect(progressInsert?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        3,
        `research-task-progress:${JOB_ID}:2:research_task.stage_changed`,
        "research_task.stage_changed",
        "queued",
        JSON.stringify({ executionAttempt: 1, workerClaimed: true }),
        2_000,
      ]);
      for (const call of fake.calls) assertPlaceholderArity(call, dialect);
    });

    it("atomically records execution completion", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return {
            rows: [
              jobRow({
                lease_expires_at: 10_000,
                lease_token: LEASE_TOKEN,
                queue_job_id: QUEUE_JOB_ID,
                row_version: 5,
                stage: "generating",
                worker_id: "worker-1",
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "research_task_progress_events" &&
          input.operation === "select" &&
          input.params.length === 1
        ) {
          return { rows: [{ sequence: 5 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.completeExecution({
          expectedRowVersion: 5,
          leaseToken: LEASE_TOKEN,
          now: 2_000,
          researchTaskJobId: JOB_ID,
        }),
      ).resolves.toMatchObject({ completedAt: 2_000, rowVersion: 6, stage: "completed" });

      const progressInsert = fake.calls.find(
        (call) => call.tableName === "research_task_progress_events" && call.operation === "insert",
      );
      expect(progressInsert?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        6,
        `research-task-progress:${JOB_ID}:6:research_task.stage_changed`,
        "research_task.stage_changed",
        "completed",
        JSON.stringify({ previousStage: "generating" }),
        2_000,
      ]);
      expect(fake.commits).toBe(1);
      for (const call of fake.calls) assertPlaceholderArity(call, dialect);
    });

    it("atomically cancels a deletion-fenced execution and its active delivery", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return {
            rows: [
              jobRow({
                lease_expires_at: 10_000,
                lease_token: LEASE_TOKEN,
                queue_job_id: QUEUE_JOB_ID,
                row_version: 5,
                stage: "retrieving",
                worker_id: "worker-1",
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "research_task_progress_events" &&
          input.operation === "select" &&
          input.params.length === 1
        ) {
          return { rows: [{ sequence: 5 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.cancelExecution({
          expectedRowVersion: 5,
          leaseToken: LEASE_TOKEN,
          now: 2_000,
          reason: "RESEARCH_TASK_DELETION_FENCE_ACTIVE",
          researchTaskJobId: JOB_ID,
        }),
      ).resolves.toMatchObject({
        completedAt: 2_000,
        error: "RESEARCH_TASK_DELETION_FENCE_ACTIVE",
        rowVersion: 6,
        stage: "canceled",
      });

      const outboxUpdate = fake.calls.find(
        (call) => call.tableName === "research_task_outbox" && call.operation === "update",
      );
      expect(outboxUpdate?.params[0]).toBe("canceled");
      const progressInsert = fake.calls.find(
        (call) => call.tableName === "research_task_progress_events" && call.operation === "insert",
      );
      expect(progressInsert?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        6,
        `research-task-progress:${JOB_ID}:6:research_task.canceled`,
        "research_task.canceled",
        "canceled",
        JSON.stringify({ reason: "RESEARCH_TASK_DELETION_FENCE_ACTIVE" }),
        2_000,
      ]);
      expect(fake.commits).toBe(1);
      for (const call of fake.calls) assertPlaceholderArity(call, dialect);
    });

    it("atomically fails and dead-letters an execution whose attempts are exhausted", async () => {
      const fake = new RecordingDatabase(dialect, async (input) => {
        if (input.tableName === "research_task_outbox" && input.sql.includes("INNER JOIN")) {
          return { rows: [outboxRow()], rowsAffected: 0 };
        }
        if (input.tableName === "research_task_jobs" && input.operation === "select") {
          return {
            rows: [jobRow({ execution_attempts: 3, max_execution_attempts: 3 })],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "research_task_outbox" &&
          input.operation === "select" &&
          input.sql.includes("delivery_revision") &&
          !input.sql.includes("SELECT *")
        ) {
          return { rows: [{ delivery_revision: 1 }], rowsAffected: 0 };
        }
        if (input.tableName === "research_task_outbox" && input.operation === "select") {
          return { rows: [outboxRow()], rowsAffected: 0 };
        }
        if (
          input.tableName === "research_task_progress_events" &&
          input.operation === "select" &&
          input.params.length === 1
        ) {
          return { rows: [{ sequence: 7 }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateProgressEventId: () => PROGRESS_ID,
      });

      await expect(
        repository.claimExecutions({
          leaseExpiresAt: 30_000,
          limit: 1,
          now: 2_000,
          workerId: "worker-1",
        }),
      ).resolves.toEqual([]);

      const progressInsert = fake.calls.find(
        (call) => call.tableName === "research_task_progress_events" && call.operation === "insert",
      );
      expect(progressInsert?.params).toEqual([
        PROGRESS_ID,
        "tenant-1",
        SPACE_ID,
        JOB_ID,
        8,
        `research-task-progress:${JOB_ID}:2:research_task.failed`,
        "research_task.failed",
        "failed",
        JSON.stringify({ error: "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED" }),
        2_000,
      ]);
      expect(fake.commits).toBe(1);
      for (const call of fake.calls) assertPlaceholderArity(call, dialect);
    });

    it("claims pending and orphaned dispatched/leased deliveries from the database", async () => {
      const fake = new RecordingDatabase(dialect);
      const repository = createDatabaseResearchTaskDurableRepository({
        database: fake.adapter,
        generateExecutionLeaseToken: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2e05",
      });

      await expect(
        repository.claimExecutions({
          leaseExpiresAt: 31_000,
          limit: 5,
          now: 1_000,
          workerId: "research-worker-1",
        }),
      ).resolves.toEqual([]);

      expect(fake.transactions).toBe(1);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]).toMatchObject({
        maxRows: 5,
        operation: "select",
        params: [1_000, 1_000, 1_000, 1_000, 1_000, 5],
        tableName: "research_task_outbox",
      });
      expect(fake.calls[0]?.sql).toContain("'pending', 'dispatched'");
      expect(fake.calls[0]?.sql).toContain("= 'leased'");
      expect(fake.calls[0]?.sql).toContain("lease_expires_at");
      expect(fake.calls[0]?.sql).toContain("NOT EXISTS");
    });
  },
);

class RecordingDatabase {
  readonly calls: DatabaseExecuteInput[] = [];
  readonly adapter: DatabaseAdapter;
  commits = 0;
  rollbacks = 0;
  transactions = 0;

  constructor(
    dialect: "postgres" | "tidb",
    respond: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult> = async () => ({
      rows: [],
      rowsAffected: 1,
    }),
  ) {
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      this.calls.push(input);
      const result = await respond(input);
      if (
        input.operation === "select" &&
        input.tableName === "knowledge_spaces" &&
        result.rows.length === 0 &&
        result.rowsAffected === 1
      ) {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      return result;
    };
    this.adapter = {
      dialect,
      kind: dialect,
      execute,
      transaction: async <T>(callback: DatabaseTransactionCallback<T>) => {
        this.transactions += 1;
        try {
          const result = await callback({ execute });
          this.commits += 1;
          return result;
        } catch (error) {
          this.rollbacks += 1;
          throw error;
        }
      },
    } as unknown as DatabaseAdapter;
  }
}

function assertPlaceholderArity(call: DatabaseExecuteInput, dialect: "postgres" | "tidb"): void {
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}

function jobRow(overrides: Partial<DatabaseRow> = {}): DatabaseRow {
  const value = job();
  return {
    access_channel: value.permissionSnapshot.accessChannel,
    budget_usd: null,
    completed_at: null,
    cost: JSON.stringify(value.cost),
    created_at: value.createdAt,
    error: null,
    execution_attempts: value.executionAttempts,
    heartbeat_at: null,
    id: value.id,
    knowledge_space_id: value.knowledgeSpaceId,
    lease_expires_at: null,
    lease_token: null,
    limits: JSON.stringify(value.limits ?? {}),
    max_execution_attempts: value.maxExecutionAttempts,
    metadata: JSON.stringify(value.metadata),
    mode: value.mode ?? null,
    paused_at: null,
    paused_from_stage: null,
    permission_snapshot_id: value.permissionSnapshot.id,
    permission_snapshot_revision: value.permissionSnapshot.revision,
    query: value.query,
    queue_job_id: null,
    resume_after: null,
    retry_at: null,
    row_version: value.rowVersion,
    stage: value.stage,
    subject_id: value.subjectId,
    tenant_id: value.tenantId,
    top_k: value.topK ?? null,
    updated_at: value.updatedAt,
    worker_id: null,
    ...overrides,
  };
}

function outboxRow(overrides: Partial<DatabaseRow> = {}): DatabaseRow {
  return {
    available_at: 1_000,
    created_at: 1_000,
    delivered_at: null,
    delivery_revision: 1,
    dispatch_attempts: 0,
    event_type: "research.task",
    id: OUTBOX_ID,
    idempotency_key: `research.task:tenant-1:${SPACE_ID}:${JOB_ID}:1`,
    last_error: null,
    locked_by: null,
    locked_until: null,
    lock_token: null,
    payload: JSON.stringify({ researchTaskJobId: JOB_ID }),
    queue_job_id: null,
    research_task_job_id: JOB_ID,
    schema_version: 1,
    status: "pending",
    updated_at: 1_000,
    ...overrides,
  };
}

function job(): ResearchTaskJob {
  return {
    cost: { entries: [], totalUsd: 0 },
    createdAt: 1_000,
    executionAttempts: 0,
    id: JOB_ID,
    knowledgeSpaceId: SPACE_ID,
    limits: { maxToolCalls: 5 },
    maxExecutionAttempts: 3,
    metadata: { source: "server" },
    mode: "deep",
    permissionSnapshot: {
      accessChannel: "interactive",
      id: SNAPSHOT_ID,
      revision: 1,
    },
    query: "Compare durable ACL behavior",
    rowVersion: 1,
    stage: "queued",
    subjectId: "subject-1",
    tenantId: "tenant-1",
    topK: 7,
    updatedAt: 1_000,
  };
}
