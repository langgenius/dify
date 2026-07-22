import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
  JobPayload,
} from "@knowledge/core";

import { assertCapabilityJobPublicationAllowed } from "./capability-job-fence";
import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import type {
  ListResearchTaskJobsInput,
  ListResearchTaskJobsResult,
  ResearchTaskDurableDispatch,
  ResearchTaskJob,
  ResearchTaskJobRepository,
  ResearchTaskJobStage,
  ResearchTaskPermissionSnapshotReference,
} from "./research-task-job";
import type { ResearchTaskProgressEventType } from "./research-task-progress";
import { appendDatabaseResearchTaskProgressEventInTransaction } from "./research-task-progress-database-repository";

export const RESEARCH_TASK_EVENT_TYPE = "research.task" as const;
export const RESEARCH_TASK_OUTBOX_SCHEMA_VERSION = 1 as const;

export type ResearchTaskOutboxStatus =
  | "pending"
  | "dispatching"
  | "dispatched"
  | "leased"
  | "completed"
  | "canceled"
  | "dead";

export interface ResearchTaskOutboxEvent {
  readonly availableAt: number;
  readonly createdAt: number;
  readonly deliveredAt?: number | undefined;
  readonly deliveryRevision: number;
  readonly dispatchAttempts: number;
  readonly eventType: typeof RESEARCH_TASK_EVENT_TYPE;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly lastError?: string | undefined;
  readonly lockedBy?: string | undefined;
  readonly lockedUntil?: number | undefined;
  readonly lockToken?: string | undefined;
  readonly payload: { readonly researchTaskJobId: string };
  readonly queueJobId?: string | undefined;
  readonly researchTaskJobId: string;
  readonly schemaVersion: typeof RESEARCH_TASK_OUTBOX_SCHEMA_VERSION;
  readonly status: ResearchTaskOutboxStatus;
  readonly updatedAt: number;
}

export interface ResearchTaskExecutionFence {
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: number;
  readonly researchTaskJobId: string;
}

export interface ClaimResearchTaskExecutionsInput {
  readonly leaseExpiresAt: number;
  readonly limit: number;
  readonly now: number;
  readonly workerId: string;
}

export interface ResearchTaskDurableRepository
  extends ResearchTaskJobRepository,
    ResearchTaskDurableDispatch {
  advanceExecution(
    input: ResearchTaskExecutionFence & { readonly nextStage: ResearchTaskJobStage },
  ): Promise<ResearchTaskJob | null>;
  claimExecution(input: {
    readonly expectedRowVersion: number;
    readonly leaseExpiresAt: number;
    readonly leaseToken: string;
    readonly now: number;
    readonly queueJobId: string;
    readonly researchTaskJobId: string;
    readonly workerId: string;
  }): Promise<ResearchTaskJob | null>;
  /**
   * Claims runnable executions directly from the database outbox. The outbox and execution
   * lease are advanced in the same transaction, so broker or process memory loss cannot strand
   * an otherwise runnable Research task.
   */
  claimExecutions(input: ClaimResearchTaskExecutionsInput): Promise<readonly ResearchTaskJob[]>;
  claimOutbox(input: {
    readonly limit: number;
    readonly lockedUntil: number;
    readonly lockToken: string;
    readonly now: number;
    readonly workerId: string;
  }): Promise<readonly ResearchTaskOutboxEvent[]>;
  cancelExecution(
    input: ResearchTaskExecutionFence & { readonly reason: string },
  ): Promise<ResearchTaskJob | null>;
  completeExecution(input: ResearchTaskExecutionFence): Promise<ResearchTaskJob | null>;
  failExecution(
    input: ResearchTaskExecutionFence & { readonly error: string },
  ): Promise<ResearchTaskJob | null>;
  heartbeatExecution(
    input: ResearchTaskExecutionFence & {
      readonly leaseExpiresAt: number;
      readonly workerId: string;
    },
  ): Promise<ResearchTaskJob | null>;
  markOutboxDispatched(input: {
    readonly deliveredAt: number;
    readonly lockToken: string;
    readonly now: number;
    readonly outboxId: string;
    readonly queueJobId: string;
  }): Promise<ResearchTaskOutboxEvent | null>;
  releaseExecutionForRetry(
    input: ResearchTaskExecutionFence & {
      readonly error: string;
      readonly retryAt: number;
    },
  ): Promise<ResearchTaskJob | null>;
  releaseOutbox(input: {
    readonly availableAt: number;
    readonly deadLetter?: boolean | undefined;
    readonly error: string;
    readonly lockToken: string;
    readonly now: number;
    readonly outboxId: string;
  }): Promise<ResearchTaskOutboxEvent | null>;
}

export interface CreateDatabaseResearchTaskDurableRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateExecutionLeaseToken?: (() => string) | undefined;
  readonly generateOutboxId?: (() => string) | undefined;
  readonly generateProgressEventId?: (() => string) | undefined;
  readonly maxOutboxClaimBatchSize?: number | undefined;
}

const jobTable = "research_task_jobs";
const outboxTable = "research_task_outbox";
const terminalStages = new Set<ResearchTaskJobStage>(["completed", "failed", "canceled"]);

export function createDatabaseResearchTaskDurableRepository({
  database,
  generateExecutionLeaseToken = randomUUID,
  generateOutboxId = randomUUID,
  generateProgressEventId = randomUUID,
  maxOutboxClaimBatchSize = 100,
}: CreateDatabaseResearchTaskDurableRepositoryOptions): ResearchTaskDurableRepository {
  positiveInteger(maxOutboxClaimBatchSize, "maxOutboxClaimBatchSize");

  const repository: ResearchTaskDurableRepository = {
    create: async (job) =>
      database.transaction(async (transaction) => {
        const normalized = normalizeJob(job);
        await insertJob(database, transaction, normalized);
        await appendJobProgress(
          database,
          transaction,
          generateProgressEventId,
          normalized,
          "research_task.started",
        );
        return cloneJob(normalized);
      }),
    start: async (job) =>
      database.transaction(async (transaction) => {
        const normalized = normalizeJob(job);
        await insertJob(database, transaction, normalized);
        await insertOutbox(database, transaction, startOutbox(generateOutboxId(), normalized, 1));
        await appendJobProgress(
          database,
          transaction,
          generateProgressEventId,
          normalized,
          "research_task.started",
        );
        return cloneJob(normalized);
      }),
    requestResume: async ({ job, resumeFromStage, updatedAt }) =>
      database.transaction(async (transaction) => {
        const current = await getJob(database, transaction, job.id, true);
        if (
          !current ||
          current.rowVersion !== job.rowVersion ||
          terminalStages.has(current.stage)
        ) {
          throw new Error("Research task resume lost its row-version fence");
        }
        const deliveryRevision = await nextDeliveryRevision(database, transaction, current.id);
        const {
          error: _error,
          queueJobId: _queueJobId,
          retryAt: _retryAt,
          ...resumeBase
        } = omitPauseAndLease(current);
        const resumed = normalizeJob({
          ...resumeBase,
          rowVersion: current.rowVersion + 1,
          stage: resumeFromStage,
          updatedAt,
        });
        await markActiveOutboxByJobId(database, transaction, current.id, "canceled", updatedAt);
        await persistJob(database, transaction, resumed, current.rowVersion);
        await insertOutbox(
          database,
          transaction,
          startOutbox(generateOutboxId(), resumed, deliveryRevision),
        );
        await appendJobProgress(
          database,
          transaction,
          generateProgressEventId,
          resumed,
          "research_task.resumed",
          { resumedFrom: current.stage },
        );
        return cloneJob(resumed);
      }),
    get: async (id) => getJob(database, database, id, false),
    getMany: async (ids) => getManyJobs(database, ids),
    listBySpace: async (input) => listJobsBySpace(database, input),
    update: async (job) =>
      database.transaction(async (transaction) => {
        const current = await getJob(database, transaction, job.id, true);
        if (!current || current.rowVersion !== job.rowVersion) {
          throw new Error("Research task update lost its row-version fence");
        }
        const updated = normalizeJob({
          ...job,
          ...(terminalStages.has(job.stage) ? clearLeaseFields() : {}),
          rowVersion: current.rowVersion + 1,
        });
        await persistJob(database, transaction, updated, current.rowVersion);
        if (terminalStages.has(updated.stage) || updated.stage === "paused") {
          await markActiveOutboxByJobId(
            database,
            transaction,
            updated.id,
            updated.stage === "canceled" || updated.stage === "paused" ? "canceled" : "completed",
            updated.updatedAt,
          );
        }
        const progressEvent = progressForJobUpdate(current, updated);
        if (progressEvent) {
          await appendJobProgress(
            database,
            transaction,
            generateProgressEventId,
            updated,
            progressEvent.type,
            progressEvent.payload,
          );
        }
        return cloneJob(updated);
      }),
    claimExecutions: async (input) => {
      positiveInteger(input.limit, "claimExecutions.limit");
      if (input.limit > maxOutboxClaimBatchSize) {
        throw new Error(`Research task execution claim limit exceeds ${maxOutboxClaimBatchSize}`);
      }
      requiredString(input.workerId, "claimExecutions.workerId");
      validTimestamp(input.now, "claimExecutions.now");
      if (validTimestamp(input.leaseExpiresAt, "claimExecutions.leaseExpiresAt") <= input.now) {
        throw new Error("Research task execution leaseExpiresAt must be after now");
      }

      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [
          input.now,
          input.now,
          input.now,
          input.now,
          input.now,
          input.limit,
        ];
        const result = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params,
          sql: `SELECT ${q(database, "outbox")}.* FROM ${q(
            database,
            outboxTable,
          )} ${q(database, "outbox")} INNER JOIN ${q(database, jobTable)} ${q(
            database,
            "job",
          )} ON ${q(database, "job")}.${q(database, "id")} = ${q(
            database,
            "outbox",
          )}.${q(database, "research_task_job_id")} WHERE ${q(
            database,
            "outbox",
          )}.${q(database, "available_at")} <= ${p(database, 1)} AND (${q(
            database,
            "outbox",
          )}.${q(database, "status")} IN ('pending', 'dispatched') OR (${q(
            database,
            "outbox",
          )}.${q(database, "status")} = 'dispatching' AND ${q(
            database,
            "outbox",
          )}.${q(database, "locked_until")} <= ${p(database, 2)}) OR (${q(
            database,
            "outbox",
          )}.${q(database, "status")} = 'leased' AND (${q(
            database,
            "job",
          )}.${q(database, "lease_expires_at")} IS NULL OR ${q(
            database,
            "job",
          )}.${q(database, "lease_expires_at")} <= ${p(database, 3)}))) AND ${q(
            database,
            "job",
          )}.${q(database, "stage")} NOT IN ('paused', 'completed', 'failed', 'canceled') AND (${q(
            database,
            "job",
          )}.${q(database, "retry_at")} IS NULL OR ${q(database, "job")}.${q(
            database,
            "retry_at",
          )} <= ${p(database, 4)}) AND (${q(database, "job")}.${q(
            database,
            "lease_expires_at",
          )} IS NULL OR ${q(database, "job")}.${q(database, "lease_expires_at")} <= ${p(
            database,
            5,
          )}) AND NOT EXISTS (SELECT 1 FROM ${q(database, outboxTable)} ${q(
            database,
            "newer",
          )} WHERE ${q(database, "newer")}.${q(database, "research_task_job_id")} = ${q(
            database,
            "outbox",
          )}.${q(database, "research_task_job_id")} AND ${q(database, "newer")}.${q(
            database,
            "delivery_revision",
          )} > ${q(database, "outbox")}.${q(database, "delivery_revision")}) ORDER BY ${q(
            database,
            "outbox",
          )}.${q(database, "available_at")}, ${q(database, "outbox")}.${q(
            database,
            "id",
          )} LIMIT ${p(database, 6)}`,
          tableName: outboxTable,
        });

        const claimed: ResearchTaskJob[] = [];
        for (const row of result.rows) {
          const candidate = outboxFromRow(row);
          // Every mutating Research path locks job -> outbox. Candidate discovery is deliberately
          // unlocked and revalidated below, avoiding the outbox -> job deadlock that a joined
          // SELECT FOR UPDATE would create against pause/resume/cancel.
          const current = await getJob(database, transaction, candidate.researchTaskJobId, true);
          const event = current ? await getOutbox(database, transaction, candidate.id, true) : null;
          if (
            !current ||
            !event ||
            !(await isLatestOutboxDelivery(database, transaction, event)) ||
            !isOutboxExecutionRunnable(event, current, input.now) ||
            current.stage === "paused" ||
            terminalStages.has(current.stage) ||
            (current.retryAt !== undefined && current.retryAt > input.now) ||
            (current.leaseExpiresAt !== undefined && current.leaseExpiresAt > input.now)
          ) {
            continue;
          }
          await assertResearchTaskCapabilityAllowed(database, transaction, current);
          if (current.executionAttempts >= current.maxExecutionAttempts) {
            const exhausted = normalizeJob({
              ...current,
              ...clearLeaseFields(),
              completedAt: input.now,
              error: "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED",
              rowVersion: current.rowVersion + 1,
              stage: "failed",
              updatedAt: input.now,
            });
            await persistJob(database, transaction, exhausted, current.rowVersion);
            await persistOutbox(database, transaction, {
              ...event,
              lastError: "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED",
              lockedBy: undefined,
              lockedUntil: undefined,
              lockToken: undefined,
              status: "dead",
              updatedAt: input.now,
            });
            await appendJobProgress(
              database,
              transaction,
              generateProgressEventId,
              exhausted,
              "research_task.failed",
              { error: "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED" },
            );
            continue;
          }

          const leaseToken = requiredString(
            generateExecutionLeaseToken(),
            "claimExecutions.leaseToken",
          );
          const queueJobId = event.id;
          const nextEvent: ResearchTaskOutboxEvent = {
            ...event,
            deliveredAt: input.now,
            lastError: undefined,
            lockedBy: undefined,
            lockedUntil: undefined,
            lockToken: undefined,
            queueJobId,
            status: "leased",
            updatedAt: input.now,
          };
          const nextJob = normalizeJob({
            ...current,
            executionAttempts: current.executionAttempts + 1,
            heartbeatAt: input.now,
            leaseExpiresAt: input.leaseExpiresAt,
            leaseToken,
            queueJobId,
            retryAt: undefined,
            rowVersion: current.rowVersion + 1,
            updatedAt: input.now,
            workerId: input.workerId,
          });
          await persistOutbox(database, transaction, nextEvent);
          await persistJob(database, transaction, nextJob, current.rowVersion);
          await appendJobProgress(
            database,
            transaction,
            generateProgressEventId,
            nextJob,
            "research_task.stage_changed",
            {
              executionAttempt: nextJob.executionAttempts,
              workerClaimed: true,
            },
          );
          claimed.push(nextJob);
        }
        return claimed.map(cloneJob);
      });
    },
    claimOutbox: async (input) => {
      positiveInteger(input.limit, "claimOutbox.limit");
      if (input.limit > maxOutboxClaimBatchSize) {
        throw new Error(`Research task outbox limit exceeds ${maxOutboxClaimBatchSize}`);
      }
      requiredString(input.workerId, "claimOutbox.workerId");
      requiredString(input.lockToken, "claimOutbox.lockToken");
      validTimestamp(input.now, "claimOutbox.now");
      if (validTimestamp(input.lockedUntil, "claimOutbox.lockedUntil") <= input.now) {
        throw new Error("Research task outbox lockedUntil must be after now");
      }
      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [input.now, input.now, input.limit];
        const result = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params,
          sql: `SELECT * FROM ${q(database, outboxTable)} WHERE ${q(
            database,
            "available_at",
          )} <= ${p(database, 1)} AND (${q(database, "status")} = 'pending' OR (${q(
            database,
            "status",
          )} = 'dispatching' AND ${q(database, "locked_until")} <= ${p(
            database,
            2,
          )})) ORDER BY ${q(database, "available_at")}, ${q(database, "id")} LIMIT ${p(
            database,
            3,
          )} FOR UPDATE SKIP LOCKED`,
          tableName: outboxTable,
        });
        const claimed: ResearchTaskOutboxEvent[] = [];
        for (const row of result.rows) {
          const event = outboxFromRow(row);
          const next: ResearchTaskOutboxEvent = {
            ...event,
            dispatchAttempts: event.dispatchAttempts + 1,
            lockedBy: input.workerId,
            lockedUntil: input.lockedUntil,
            lockToken: input.lockToken,
            status: "dispatching",
            updatedAt: input.now,
          };
          await persistOutbox(database, transaction, next);
          claimed.push(next);
        }
        return claimed.map(cloneOutbox);
      });
    },
    markOutboxDispatched: async (input) =>
      database.transaction(async (transaction) => {
        const discovered = await getOutbox(database, transaction, input.outboxId, false);
        if (!discovered) {
          return null;
        }
        const job = await getJob(database, transaction, discovered.researchTaskJobId, true);
        const event = await getOutbox(database, transaction, input.outboxId, true);
        if (
          !event ||
          event.status !== "dispatching" ||
          event.lockToken !== input.lockToken ||
          (event.lockedUntil ?? 0) <= input.now
        ) {
          return null;
        }
        if (!job || terminalStages.has(job.stage)) {
          return null;
        }
        const updatedEvent: ResearchTaskOutboxEvent = {
          ...event,
          deliveredAt: input.deliveredAt,
          lastError: undefined,
          lockedBy: undefined,
          lockedUntil: undefined,
          lockToken: undefined,
          queueJobId: input.queueJobId,
          status: "dispatched",
          updatedAt: input.now,
        };
        const updatedJob = normalizeJob({
          ...job,
          queueJobId: input.queueJobId,
          retryAt: undefined,
          rowVersion: job.rowVersion + 1,
          updatedAt: input.now,
        });
        await persistOutbox(database, transaction, updatedEvent);
        await persistJob(database, transaction, updatedJob, job.rowVersion);
        return cloneOutbox(updatedEvent);
      }),
    releaseOutbox: async (input) =>
      database.transaction(async (transaction) => {
        const discovered = await getOutbox(database, transaction, input.outboxId, false);
        if (!discovered) {
          return null;
        }
        const job = input.deadLetter
          ? await getJob(database, transaction, discovered.researchTaskJobId, true)
          : null;
        const event = await getOutbox(database, transaction, input.outboxId, true);
        if (!event || event.status !== "dispatching" || event.lockToken !== input.lockToken) {
          return null;
        }
        const released: ResearchTaskOutboxEvent = {
          ...event,
          availableAt: input.availableAt,
          lastError: input.error,
          lockedBy: undefined,
          lockedUntil: undefined,
          lockToken: undefined,
          status: input.deadLetter ? "dead" : "pending",
          updatedAt: input.now,
        };
        await persistOutbox(database, transaction, released);
        if (input.deadLetter) {
          if (job && !terminalStages.has(job.stage)) {
            const failed = normalizeJob({
              ...job,
              ...clearLeaseFields(),
              completedAt: input.now,
              error: "RESEARCH_TASK_DISPATCH_DEAD",
              rowVersion: job.rowVersion + 1,
              stage: "failed",
              updatedAt: input.now,
            });
            await persistJob(database, transaction, failed, job.rowVersion);
            await appendJobProgress(
              database,
              transaction,
              generateProgressEventId,
              failed,
              "research_task.failed",
              { error: "RESEARCH_TASK_DISPATCH_DEAD" },
            );
          }
        }
        return cloneOutbox(released);
      }),
    claimExecution: async (input) =>
      database.transaction(async (transaction) => {
        const current = await getJob(database, transaction, input.researchTaskJobId, true);
        if (
          !current ||
          current.rowVersion !== input.expectedRowVersion ||
          current.queueJobId !== input.queueJobId ||
          current.stage === "paused" ||
          terminalStages.has(current.stage) ||
          current.executionAttempts >= current.maxExecutionAttempts ||
          (current.retryAt !== undefined && current.retryAt > input.now) ||
          (current.leaseExpiresAt !== undefined && current.leaseExpiresAt > input.now) ||
          input.leaseExpiresAt <= input.now
        ) {
          return null;
        }
        await assertResearchTaskCapabilityAllowed(database, transaction, current);
        const claimed = normalizeJob({
          ...current,
          executionAttempts: current.executionAttempts + 1,
          heartbeatAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          leaseToken: input.leaseToken,
          retryAt: undefined,
          rowVersion: current.rowVersion + 1,
          updatedAt: input.now,
          workerId: input.workerId,
        });
        await persistJob(database, transaction, claimed, current.rowVersion);
        await updateOutboxStatusByQueueId(
          database,
          transaction,
          input.queueJobId,
          "leased",
          input.now,
        );
        await appendJobProgress(
          database,
          transaction,
          generateProgressEventId,
          claimed,
          "research_task.stage_changed",
          {
            executionAttempt: claimed.executionAttempts,
            workerClaimed: true,
          },
        );
        return cloneJob(claimed);
      }),
    heartbeatExecution: async (input) =>
      fencedJobMutation(database, input, (current) => {
        if (current.workerId !== input.workerId || input.leaseExpiresAt <= input.now) {
          return null;
        }
        return normalizeJob({
          ...current,
          heartbeatAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          rowVersion: current.rowVersion + 1,
          updatedAt: input.now,
        });
      }),
    advanceExecution: async (input) =>
      fencedJobMutation(
        database,
        input,
        (current) => {
          assertExecutionAdvance(current.stage, input.nextStage);
          return normalizeJob({
            ...current,
            rowVersion: current.rowVersion + 1,
            stage: input.nextStage,
            updatedAt: input.now,
          });
        },
        {
          generateProgressEventId,
          progress: (current) => ({
            payload: { previousStage: current.stage },
            type: "research_task.stage_changed",
          }),
        },
      ),
    releaseExecutionForRetry: async (input) =>
      database.transaction(async (transaction) => {
        const current = await getJob(database, transaction, input.researchTaskJobId, true);
        if (
          !matchesExecutionFence(current, input) ||
          input.retryAt <= input.now ||
          current.executionAttempts >= current.maxExecutionAttempts
        ) {
          return null;
        }
        const updated = normalizeJob({
          ...current,
          ...clearLeaseFields(),
          error: input.error,
          retryAt: input.retryAt,
          rowVersion: current.rowVersion + 1,
          updatedAt: input.now,
        });
        await persistJob(database, transaction, updated, current.rowVersion);
        await releaseCurrentOutboxForRetry(database, transaction, current, input);
        await appendJobProgress(
          database,
          transaction,
          generateProgressEventId,
          updated,
          "research_task.stage_changed",
          {
            error: input.error,
            retryAt: input.retryAt,
            retryScheduled: true,
          },
        );
        return cloneJob(updated);
      }),
    completeExecution: async (input) =>
      terminalExecution(database, input, "completed", undefined, generateProgressEventId),
    cancelExecution: async (input) =>
      terminalExecution(database, input, "canceled", input.reason, generateProgressEventId),
    failExecution: async (input) =>
      terminalExecution(database, input, "failed", input.error, generateProgressEventId),
  };

  return repository;
}

async function fencedJobMutation(
  database: DatabaseAdapter,
  input: ResearchTaskExecutionFence,
  mutate: (current: ResearchTaskJob) => ResearchTaskJob | null,
  options?:
    | {
        readonly generateProgressEventId: () => string;
        readonly progress: (
          current: ResearchTaskJob,
          updated: ResearchTaskJob,
        ) => DurableProgressEvent;
      }
    | undefined,
): Promise<ResearchTaskJob | null> {
  return database.transaction(async (transaction) => {
    const current = await getJob(database, transaction, input.researchTaskJobId, true);
    if (!matchesExecutionFence(current, input)) {
      return null;
    }
    const updated = mutate(current);
    if (!updated) {
      return null;
    }
    await persistJob(database, transaction, updated, current.rowVersion);
    if (options) {
      const progress = options.progress(current, updated);
      await appendJobProgress(
        database,
        transaction,
        options.generateProgressEventId,
        updated,
        progress.type,
        progress.payload,
      );
    }
    return cloneJob(updated);
  });
}

function matchesExecutionFence(
  current: ResearchTaskJob | null,
  input: ResearchTaskExecutionFence,
): current is ResearchTaskJob {
  return Boolean(
    current &&
      current.rowVersion === input.expectedRowVersion &&
      current.leaseToken === input.leaseToken &&
      (current.leaseExpiresAt ?? 0) > input.now &&
      !terminalStages.has(current.stage),
  );
}

async function terminalExecution(
  database: DatabaseAdapter,
  input: ResearchTaskExecutionFence,
  stage: "canceled" | "completed" | "failed",
  error: string | undefined,
  generateProgressEventId: () => string,
): Promise<ResearchTaskJob | null> {
  return database.transaction(async (transaction) => {
    const current = await getJob(database, transaction, input.researchTaskJobId, true);
    if (!matchesExecutionFence(current, input)) {
      return null;
    }
    if (stage === "completed" && current.stage !== "generating") {
      throw new Error(`Research task cannot complete from ${current.stage}`);
    }
    if (stage === "completed") {
      await assertResearchTaskCapabilityAllowed(database, transaction, current);
    }
    const { error: _currentError, retryAt: _currentRetryAt, ...terminalBase } = current;
    const updated = normalizeJob({
      ...terminalBase,
      ...clearLeaseFields(),
      completedAt: input.now,
      ...(error ? { error } : {}),
      rowVersion: current.rowVersion + 1,
      stage,
      updatedAt: input.now,
    });
    await persistJob(database, transaction, updated, current.rowVersion);
    await markActiveOutboxByJobId(
      database,
      transaction,
      current.id,
      stage === "canceled" ? "canceled" : "completed",
      input.now,
    );
    await appendJobProgress(
      database,
      transaction,
      generateProgressEventId,
      updated,
      stage === "failed"
        ? "research_task.failed"
        : stage === "canceled"
          ? "research_task.canceled"
          : "research_task.stage_changed",
      stage === "failed"
        ? { error: error ?? "Research task execution failed" }
        : stage === "canceled"
          ? { reason: error ?? "Research task execution canceled" }
          : { previousStage: current.stage },
    );
    return cloneJob(updated);
  });
}

interface DurableProgressEvent {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly type: ResearchTaskProgressEventType;
}

function progressForJobUpdate(
  current: ResearchTaskJob,
  updated: ResearchTaskJob,
): DurableProgressEvent | null {
  if (current.stage === updated.stage) {
    return null;
  }
  if (updated.stage === "canceled") {
    return {
      payload: updated.error ? { reason: updated.error } : {},
      type: "research_task.canceled",
    };
  }
  if (updated.stage === "failed") {
    return {
      payload: updated.error ? { error: updated.error } : {},
      type: "research_task.failed",
    };
  }
  if (updated.stage === "paused") {
    return {
      payload: updated.error ? { reason: updated.error } : {},
      type: "research_task.paused",
    };
  }
  return {
    payload: { previousStage: current.stage },
    type: "research_task.stage_changed",
  };
}

async function appendJobProgress(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  generateId: () => string,
  job: ResearchTaskJob,
  type: ResearchTaskProgressEventType,
  payload: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await appendDatabaseResearchTaskProgressEventInTransaction({
    database,
    executor,
    generateId,
    input: {
      idempotencyKey: `research-task-progress:${job.id}:${job.rowVersion}:${type}`,
      knowledgeSpaceId: job.knowledgeSpaceId,
      payload,
      researchTaskJobId: job.id,
      stage: job.stage,
      tenantId: job.tenantId,
      type,
    },
    now: job.updatedAt,
  });
}

function startOutbox(
  id: string,
  job: ResearchTaskJob,
  deliveryRevision: number,
): ResearchTaskOutboxEvent {
  return {
    availableAt: job.updatedAt,
    createdAt: job.updatedAt,
    deliveryRevision,
    dispatchAttempts: 0,
    eventType: RESEARCH_TASK_EVENT_TYPE,
    id,
    idempotencyKey: `research.task:${job.tenantId}:${job.knowledgeSpaceId}:${job.id}:${deliveryRevision}`,
    payload: { researchTaskJobId: job.id },
    researchTaskJobId: job.id,
    schemaVersion: RESEARCH_TASK_OUTBOX_SCHEMA_VERSION,
    status: "pending",
    updatedAt: job.updatedAt,
  };
}

async function nextDeliveryRevision(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  jobId: string,
): Promise<number> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [jobId],
    sql: `SELECT ${q(database, "delivery_revision")} FROM ${q(
      database,
      outboxTable,
    )} WHERE ${q(database, "research_task_job_id")} = ${p(
      database,
      1,
    )} ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1 FOR UPDATE`,
    tableName: outboxTable,
  });
  return result.rows[0] ? numberColumn(result.rows[0], "delivery_revision") + 1 : 1;
}

async function getManyJobs(
  database: DatabaseAdapter,
  ids: readonly string[],
): Promise<ResearchTaskJob[]> {
  const unique = [...new Set(ids.map((id) => requiredString(id, "jobId")))];
  if (unique.length === 0) {
    return [];
  }
  const placeholders = unique.map((_, index) => p(database, index + 1)).join(", ");
  const result = await database.execute({
    maxRows: unique.length,
    operation: "select",
    params: unique,
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "id")} IN (${placeholders})`,
    tableName: jobTable,
  });
  const byId = new Map(
    result.rows.map((row) => {
      const job = jobFromRow(row);
      return [job.id, job] as const;
    }),
  );
  return unique.flatMap((id) => {
    const job = byId.get(id);
    return job ? [job] : [];
  });
}

async function listJobsBySpace(
  database: DatabaseAdapter,
  input: ListResearchTaskJobsInput,
): Promise<ListResearchTaskJobsResult> {
  const tenantId = requiredString(input.tenantId, "list tenantId");
  const knowledgeSpaceId = requiredString(input.knowledgeSpaceId, "list knowledgeSpaceId");
  const subjectId = requiredString(
    input.capabilityRequester.subjectId,
    "list capabilityRequester.subjectId",
  );
  const callerKind = requiredString(
    input.capabilityRequester.callerKind,
    "list capabilityRequester.callerKind",
  );
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("Research task list limit must be between 1 and 100");
  }
  if (
    input.cursor &&
    (!Number.isSafeInteger(input.cursor.createdAt) ||
      input.cursor.createdAt < 0 ||
      !input.cursor.id.trim())
  ) {
    throw new Error("Research task list cursor is invalid");
  }
  const params: DatabaseQueryValue[] = [tenantId, knowledgeSpaceId, subjectId, callerKind];
  const cursorClause = input.cursor
    ? (() => {
        params.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id.trim());
        return ` AND (job_row.${q(database, "created_at")} < ${p(
          database,
          params.length - 2,
        )} OR (job_row.${q(database, "created_at")} = ${p(
          database,
          params.length - 1,
        )} AND job_row.${q(database, "id")} < ${p(database, params.length)}))`;
      })()
    : "";
  params.push(input.limit + 1);
  const result = await database.execute({
    maxRows: input.limit + 1,
    operation: "select",
    params,
    sql: `SELECT job_row.* FROM ${q(database, jobTable)} job_row INNER JOIN ${q(
      database,
      "capability_grants",
    )} grant_row ON grant_row.${q(database, "tenant_id")} = job_row.${q(
      database,
      "tenant_id",
    )} AND grant_row.${q(database, "knowledge_space_id")} = job_row.${q(
      database,
      "knowledge_space_id",
    )} AND grant_row.${q(database, "grant_id")} = job_row.${q(
      database,
      "capability_grant_id",
    )} WHERE job_row.${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND job_row.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND grant_row.${q(database, "subject_id")} = ${p(
      database,
      3,
    )} AND grant_row.${q(database, "caller_kind")} = ${p(
      database,
      4,
    )}${cursorClause} ORDER BY job_row.${q(
      database,
      "created_at",
    )} DESC, job_row.${q(database, "id")} DESC LIMIT ${p(database, params.length)}`,
    tableName: jobTable,
  });
  const selected = result.rows.map(jobFromRow);
  const items = selected.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    ...(selected.length > input.limit && last
      ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
      : {}),
  };
}

async function getJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  lock: boolean,
): Promise<ResearchTaskJob | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [requiredString(id, "jobId")],
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "id")} = ${p(
      database,
      1,
    )}${lock ? " FOR UPDATE" : ""}`,
    tableName: jobTable,
  });
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

async function getOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  lock: boolean,
): Promise<ResearchTaskOutboxEvent | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [requiredString(id, "outboxId")],
    sql: `SELECT * FROM ${q(database, outboxTable)} WHERE ${q(database, "id")} = ${p(
      database,
      1,
    )}${lock ? " FOR UPDATE" : ""}`,
    tableName: outboxTable,
  });
  return result.rows[0] ? outboxFromRow(result.rows[0]) : null;
}

async function isLatestOutboxDelivery(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  event: ResearchTaskOutboxEvent,
): Promise<boolean> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [event.researchTaskJobId],
    sql: `SELECT ${q(database, "delivery_revision")} FROM ${q(
      database,
      outboxTable,
    )} WHERE ${q(database, "research_task_job_id")} = ${p(
      database,
      1,
    )} ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1`,
    tableName: outboxTable,
  });
  return result.rows[0]
    ? numberColumn(result.rows[0], "delivery_revision") === event.deliveryRevision
    : false;
}

function isOutboxExecutionRunnable(
  event: ResearchTaskOutboxEvent,
  job: ResearchTaskJob,
  now: number,
): boolean {
  if (event.availableAt > now) {
    return false;
  }
  if (event.status === "pending" || event.status === "dispatched") {
    return true;
  }
  if (event.status === "dispatching") {
    return (event.lockedUntil ?? Number.POSITIVE_INFINITY) <= now;
  }
  return event.status === "leased" && (job.leaseExpiresAt ?? 0) <= now;
}

const jobColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "capability_grant_id",
  "subject_id",
  "permission_snapshot_id",
  "permission_snapshot_revision",
  "access_channel",
  "query",
  "mode",
  "top_k",
  "budget_usd",
  "limits",
  "metadata",
  "cost",
  "stage",
  "paused_from_stage",
  "queue_job_id",
  "error",
  "resume_after",
  "paused_at",
  "completed_at",
  "row_version",
  "execution_attempts",
  "max_execution_attempts",
  "worker_id",
  "lease_token",
  "lease_expires_at",
  "heartbeat_at",
  "retry_at",
  "created_at",
  "updated_at",
] as const;

async function insertJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: ResearchTaskJob,
): Promise<void> {
  await lockResearchTaskCreationSpace(database, executor, job);
  await assertResearchTaskCapabilityAllowed(database, executor, job);
  const values = jobValues(job);
  const fenceParams = database.dialect === "postgres" ? [] : [job.tenantId, job.knowledgeSpaceId];
  const tenantFence =
    database.dialect === "postgres" ? p(database, 2) : p(database, values.length + 1);
  const spaceFence =
    database.dialect === "postgres" ? p(database, 3) : p(database, values.length + 2);
  const result = await executor.execute({
    maxRows: database.dialect === "postgres" ? 1 : 0,
    operation: "insert",
    params: [...values, ...fenceParams],
    sql: `INSERT INTO ${q(database, jobTable)} (${jobColumns
      .map((column) => q(database, column))
      .join(", ")}) SELECT ${jobColumns
      .map((column, index) => jsonValue(database, index + 1, column))
      .join(", ")} WHERE NOT EXISTS (SELECT 1 FROM ${q(
      database,
      "deletion_jobs",
    )} active_deletion WHERE active_deletion.${q(database, "tenant_id")} = ${tenantFence} AND active_deletion.${q(
      database,
      "knowledge_space_id",
    )} = ${spaceFence} AND active_deletion.${q(database, "active_slot")} = 1)${
      database.dialect === "postgres" ? ` RETURNING ${q(database, "id")}` : ""
    }`,
    tableName: jobTable,
  });
  if (result.rowsAffected !== 1) {
    throw new Error("Research task creation rejected by active durable deletion");
  }
}

async function lockResearchTaskCreationSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: Pick<ResearchTaskJob, "knowledgeSpaceId" | "tenantId">,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_spaces")} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "id")} = ${p(
      database,
      2,
    )} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(
      database,
      "deletion_job_id",
    )} IS NULL FOR UPDATE`,
    tableName: "knowledge_spaces",
  });
  if (result.rows.length !== 1) {
    throw new Error("Research task creation rejected because knowledge space is unavailable");
  }
}

async function persistJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: ResearchTaskJob,
  expectedRowVersion: number,
): Promise<void> {
  const values = jobValues(job);
  const persistedValues = values.slice(1);
  const params = [...persistedValues, job.id, expectedRowVersion];
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, jobTable)} SET ${jobColumns
      .slice(1)
      .map((column, index) => `${q(database, column)} = ${jsonValue(database, index + 1, column)}`)
      .join(", ")} WHERE ${q(database, "id")} = ${p(database, persistedValues.length + 1)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, persistedValues.length + 2)}`,
    tableName: jobTable,
  });
  if (result.rowsAffected !== 1) {
    throw new Error("Research task database update lost its row-version fence");
  }
}

function jobValues(job: ResearchTaskJob): DatabaseQueryValue[] {
  return [
    job.id,
    job.tenantId,
    job.knowledgeSpaceId,
    job.capabilityGrantId ?? null,
    job.subjectId ?? null,
    job.permissionSnapshot?.id ?? null,
    job.permissionSnapshot?.revision ?? null,
    job.permissionSnapshot?.accessChannel ?? null,
    job.query,
    job.mode ?? null,
    job.topK ?? null,
    job.budgetUsd ?? null,
    JSON.stringify(job.limits ?? {}),
    JSON.stringify(job.metadata),
    JSON.stringify(job.cost),
    job.stage,
    job.pausedFromStage ?? null,
    job.queueJobId ?? null,
    job.error ?? null,
    job.resumeAfter ?? null,
    job.pausedAt ?? null,
    job.completedAt ?? null,
    job.rowVersion,
    job.executionAttempts,
    job.maxExecutionAttempts,
    job.workerId ?? null,
    job.leaseToken ?? null,
    job.leaseExpiresAt ?? null,
    job.heartbeatAt ?? null,
    job.retryAt ?? null,
    job.createdAt,
    job.updatedAt,
  ];
}

const outboxColumns = [
  "id",
  "research_task_job_id",
  "delivery_revision",
  "event_type",
  "schema_version",
  "idempotency_key",
  "payload",
  "status",
  "available_at",
  "dispatch_attempts",
  "locked_by",
  "locked_until",
  "lock_token",
  "queue_job_id",
  "last_error",
  "delivered_at",
  "created_at",
  "updated_at",
] as const;

async function insertOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  event: ResearchTaskOutboxEvent,
): Promise<void> {
  const values = outboxValues(event);
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: values,
    sql: `INSERT INTO ${q(database, outboxTable)} (${outboxColumns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${outboxColumns
      .map((column, index) => jsonValue(database, index + 1, column))
      .join(", ")})`,
    tableName: outboxTable,
  });
}

async function persistOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  event: ResearchTaskOutboxEvent,
): Promise<void> {
  const values = outboxValues(event);
  const persistedValues = values.slice(1);
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [...persistedValues, event.id],
    sql: `UPDATE ${q(database, outboxTable)} SET ${outboxColumns
      .slice(1)
      .map((column, index) => `${q(database, column)} = ${jsonValue(database, index + 1, column)}`)
      .join(", ")} WHERE ${q(database, "id")} = ${p(database, persistedValues.length + 1)}`,
    tableName: outboxTable,
  });
  if (result.rowsAffected !== 1) {
    throw new Error("Research task outbox update lost its lock fence");
  }
}

function outboxValues(event: ResearchTaskOutboxEvent): DatabaseQueryValue[] {
  return [
    event.id,
    event.researchTaskJobId,
    event.deliveryRevision,
    event.eventType,
    event.schemaVersion,
    event.idempotencyKey,
    JSON.stringify(event.payload),
    event.status,
    event.availableAt,
    event.dispatchAttempts,
    event.lockedBy ?? null,
    event.lockedUntil ?? null,
    event.lockToken ?? null,
    event.queueJobId ?? null,
    event.lastError ?? null,
    event.deliveredAt ?? null,
    event.createdAt,
    event.updatedAt,
  ];
}

async function markActiveOutboxByJobId(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  researchTaskJobId: string,
  status: "canceled" | "completed",
  updatedAt: number,
): Promise<void> {
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [status, updatedAt, researchTaskJobId],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = ${p(
      database,
      1,
    )}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(
      database,
      "locked_by",
    )} = NULL, ${q(database, "locked_until")} = NULL, ${q(
      database,
      "lock_token",
    )} = NULL WHERE ${q(database, "research_task_job_id")} = ${p(database, 3)} AND ${q(
      database,
      "status",
    )} IN ('pending', 'dispatching', 'dispatched', 'leased')`,
    tableName: outboxTable,
  });
}

async function releaseCurrentOutboxForRetry(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: ResearchTaskJob,
  input: ResearchTaskExecutionFence & { readonly error: string; readonly retryAt: number },
): Promise<void> {
  if (!job.queueJobId) {
    throw new Error("Research task retry has no durable outbox delivery");
  }
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [input.retryAt, input.error, input.now, job.queueJobId, job.id],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'pending', ${q(
      database,
      "available_at",
    )} = ${p(database, 1)}, ${q(database, "last_error")} = ${p(
      database,
      2,
    )}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(
      database,
      "locked_by",
    )} = NULL, ${q(database, "locked_until")} = NULL, ${q(
      database,
      "lock_token",
    )} = NULL WHERE ${q(database, "queue_job_id")} = ${p(
      database,
      4,
    )} AND ${q(database, "research_task_job_id")} = ${p(database, 5)} AND ${q(
      database,
      "status",
    )} = 'leased'`,
    tableName: outboxTable,
  });
  if (result.rowsAffected !== 1) {
    throw new Error("Research task retry lost its durable outbox fence");
  }
}

async function updateOutboxStatusByQueueId(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  queueJobId: string,
  status: ResearchTaskOutboxStatus,
  updatedAt: number,
): Promise<void> {
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [status, updatedAt, queueJobId],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = ${p(
      database,
      1,
    )}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(
      database,
      "queue_job_id",
    )} = ${p(database, 3)}`,
    tableName: outboxTable,
  });
}

function jobFromRow(row: DatabaseRow): ResearchTaskJob {
  const limits = jsonObjectColumn(row, "limits") as ResearchTaskJob["limits"];
  const metadata = jsonObjectColumn(row, "metadata") as Record<string, JobPayload>;
  const cost = jsonObjectColumn(row, "cost") as unknown as ResearchTaskJob["cost"];
  const budgetUsd = optionalNumberColumn(row, "budget_usd");
  const completedAt = optionalSafeIntegerColumn(row, "completed_at");
  const error = optionalStringColumn(row, "error");
  const heartbeatAt = optionalSafeIntegerColumn(row, "heartbeat_at");
  const leaseExpiresAt = optionalSafeIntegerColumn(row, "lease_expires_at");
  const leaseToken = optionalStringColumn(row, "lease_token");
  const mode = optionalStringColumn(row, "mode") as ResearchTaskJob["mode"];
  const pausedAt = optionalSafeIntegerColumn(row, "paused_at");
  const pausedFromStage = optionalStringColumn(
    row,
    "paused_from_stage",
  ) as ResearchTaskJob["pausedFromStage"];
  const queueJobId = optionalStringColumn(row, "queue_job_id");
  const resumeAfter = optionalSafeIntegerColumn(row, "resume_after");
  const retryAt = optionalSafeIntegerColumn(row, "retry_at");
  const topK = optionalNumberColumn(row, "top_k");
  const workerId = optionalStringColumn(row, "worker_id");
  const capabilityGrantId = optionalStringColumn(row, "capability_grant_id");
  const subjectId = optionalStringColumn(row, "subject_id");
  const permissionSnapshotId = optionalStringColumn(row, "permission_snapshot_id");
  const permissionSnapshotRevision = optionalNumberColumn(row, "permission_snapshot_revision");
  const accessChannel = optionalStringColumn(row, "access_channel");
  const permissionSnapshot =
    permissionSnapshotId !== undefined &&
    permissionSnapshotRevision !== undefined &&
    accessChannel !== undefined
      ? {
          accessChannel: accessChannel as ResearchTaskPermissionSnapshotReference["accessChannel"],
          id: permissionSnapshotId,
          revision: permissionSnapshotRevision,
        }
      : undefined;
  return normalizeJob({
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    ...(capabilityGrantId === undefined ? {} : { capabilityGrantId }),
    ...(completedAt === undefined ? {} : { completedAt }),
    cost,
    createdAt: safeIntegerColumn(row, "created_at"),
    ...(error === undefined ? {} : { error }),
    executionAttempts: numberColumn(row, "execution_attempts"),
    ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
    ...(leaseToken === undefined ? {} : { leaseToken }),
    limits: Object.keys(limits ?? {}).length > 0 ? limits : undefined,
    maxExecutionAttempts: numberColumn(row, "max_execution_attempts"),
    metadata,
    ...(mode === undefined ? {} : { mode }),
    ...(pausedAt === undefined ? {} : { pausedAt }),
    ...(pausedFromStage === undefined ? {} : { pausedFromStage }),
    ...(permissionSnapshot === undefined ? {} : { permissionSnapshot }),
    query: stringColumn(row, "query"),
    ...(queueJobId === undefined ? {} : { queueJobId }),
    ...(resumeAfter === undefined ? {} : { resumeAfter }),
    ...(retryAt === undefined ? {} : { retryAt }),
    rowVersion: numberColumn(row, "row_version"),
    stage: stringColumn(row, "stage") as ResearchTaskJobStage,
    ...(subjectId === undefined ? {} : { subjectId }),
    tenantId: stringColumn(row, "tenant_id"),
    ...(topK === undefined ? {} : { topK }),
    updatedAt: safeIntegerColumn(row, "updated_at"),
    ...(workerId === undefined ? {} : { workerId }),
  });
}

function outboxFromRow(row: DatabaseRow): ResearchTaskOutboxEvent {
  const payload = jsonObjectColumn(row, "payload");
  if (typeof payload.researchTaskJobId !== "string") {
    throw new Error("Research task outbox payload must contain only researchTaskJobId");
  }
  return {
    availableAt: safeIntegerColumn(row, "available_at"),
    createdAt: safeIntegerColumn(row, "created_at"),
    deliveredAt: optionalSafeIntegerColumn(row, "delivered_at"),
    deliveryRevision: numberColumn(row, "delivery_revision"),
    dispatchAttempts: numberColumn(row, "dispatch_attempts"),
    eventType: stringColumn(row, "event_type") as typeof RESEARCH_TASK_EVENT_TYPE,
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    lastError: optionalStringColumn(row, "last_error"),
    lockedBy: optionalStringColumn(row, "locked_by"),
    lockedUntil: optionalSafeIntegerColumn(row, "locked_until"),
    lockToken: optionalStringColumn(row, "lock_token"),
    payload: { researchTaskJobId: payload.researchTaskJobId },
    queueJobId: optionalStringColumn(row, "queue_job_id"),
    researchTaskJobId: stringColumn(row, "research_task_job_id"),
    schemaVersion: numberColumn(row, "schema_version") as 1,
    status: stringColumn(row, "status") as ResearchTaskOutboxStatus,
    updatedAt: safeIntegerColumn(row, "updated_at"),
  };
}

function normalizeJob(job: ResearchTaskJob): ResearchTaskJob {
  requiredString(job.id, "job.id");
  requiredString(job.tenantId, "job.tenantId");
  requiredString(job.knowledgeSpaceId, "job.knowledgeSpaceId");
  const hasCapabilityBinding = job.capabilityGrantId !== undefined;
  const hasLegacyBinding = job.subjectId !== undefined || job.permissionSnapshot !== undefined;
  if (hasCapabilityBinding === hasLegacyBinding) {
    throw new Error("Research task requires exactly one durable authorization binding");
  }
  if (job.capabilityGrantId !== undefined) {
    requiredString(job.capabilityGrantId, "job.capabilityGrantId");
  } else {
    if (!job.subjectId || !job.permissionSnapshot) {
      throw new Error("Research task legacy authorization binding is incomplete");
    }
    requiredString(job.subjectId, "job.subjectId");
    requiredString(job.permissionSnapshot.id, "job.permissionSnapshot.id");
    positiveInteger(job.permissionSnapshot.revision, "job.permissionSnapshot.revision");
  }
  positiveInteger(job.rowVersion, "job.rowVersion");
  positiveInteger(job.maxExecutionAttempts, "job.maxExecutionAttempts");
  if (!Number.isSafeInteger(job.executionAttempts) || job.executionAttempts < 0) {
    throw new Error("Research task job.executionAttempts must be nonnegative");
  }
  return cloneJob(job);
}

async function assertResearchTaskCapabilityAllowed(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: Pick<ResearchTaskJob, "capabilityGrantId" | "knowledgeSpaceId" | "tenantId">,
): Promise<void> {
  if (!job.capabilityGrantId) return;
  await assertCapabilityJobPublicationAllowed(database, executor, {
    capabilityGrantId: job.capabilityGrantId,
    knowledgeSpaceId: job.knowledgeSpaceId,
    tenantId: job.tenantId,
  });
}

function assertExecutionAdvance(current: ResearchTaskJobStage, next: ResearchTaskJobStage): void {
  const order: readonly ResearchTaskJobStage[] = [
    "queued",
    "planning",
    "retrieving",
    "analyzing",
    "generating",
  ];
  if (order.indexOf(next) !== order.indexOf(current) + 1) {
    throw new Error(`Research task cannot advance execution from ${current} to ${next}`);
  }
}

function omitPauseAndLease(job: ResearchTaskJob): ResearchTaskJob {
  const {
    heartbeatAt: _heartbeatAt,
    leaseExpiresAt: _leaseExpiresAt,
    leaseToken: _leaseToken,
    pausedAt: _pausedAt,
    pausedFromStage: _pausedFromStage,
    resumeAfter: _resumeAfter,
    workerId: _workerId,
    ...rest
  } = job;
  return rest;
}

function clearLeaseFields(): Pick<
  ResearchTaskJob,
  "heartbeatAt" | "leaseExpiresAt" | "leaseToken" | "workerId"
> {
  return {
    heartbeatAt: undefined,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    workerId: undefined,
  };
}

function jsonValue(database: DatabaseAdapter, position: number, column: string): string {
  const placeholder = p(database, position);
  if (column !== "limits" && column !== "metadata" && column !== "cost" && column !== "payload") {
    return placeholder;
  }
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function requiredString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Research task ${field} is required`);
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research task ${field} must be a positive integer`);
  }
  return value;
}

function validTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Research task ${field} must be a nonnegative integer timestamp`);
  }
  return value;
}

function cloneJob(job: ResearchTaskJob): ResearchTaskJob {
  return JSON.parse(JSON.stringify(job)) as ResearchTaskJob;
}

function cloneOutbox(event: ResearchTaskOutboxEvent): ResearchTaskOutboxEvent {
  return JSON.parse(JSON.stringify(event)) as ResearchTaskOutboxEvent;
}

function safeIntegerColumn(row: DatabaseRow, column: string): number {
  const value = row[column];
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Database row column ${column} must be a nonnegative safe integer`);
  }
  return parsed;
}

function optionalSafeIntegerColumn(row: DatabaseRow, column: string): number | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : safeIntegerColumn(row, column);
}
