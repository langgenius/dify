import type {
  DequeueJobsInput,
  EnqueueJobInput,
  FailJobOptions,
  HeartbeatJobInput,
  JobQueueAdapter,
  JobRecord,
  LeaseJobsInput,
  RetryJobOptions,
} from "@knowledge/core";

import { createInlineJobQueueAdapter } from "./job-queue";

export interface PgBossClient {
  cancel?(bossJobId: string): Promise<void>;
  complete?(bossJobId: string): Promise<void>;
  fail?(bossJobId: string, error: string): Promise<void>;
  send(
    name: string,
    data: unknown,
    options?: {
      readonly singletonKey?: string;
      readonly startAfter?: Date;
    },
  ): Promise<string | { readonly id: string }>;
}

export interface PgBossJobQueueAdapterOptions {
  readonly boss?: PgBossClient;
  readonly maxBatchSize: number;
  readonly maxLeaseMs?: number;
  readonly maxQueuedJobs: number;
  readonly maxRetainedJobs?: number;
  readonly now?: () => number;
}

export function createPgBossJobQueueAdapter({
  boss = createNoopPgBossClient(),
  maxBatchSize,
  maxLeaseMs,
  maxQueuedJobs,
  maxRetainedJobs,
  now = Date.now,
}: PgBossJobQueueAdapterOptions): JobQueueAdapter {
  const inline = createInlineJobQueueAdapter({
    kind: "pg-boss",
    maxBatchSize,
    ...(maxLeaseMs !== undefined ? { maxLeaseMs } : {}),
    maxQueuedJobs,
    ...(maxRetainedJobs !== undefined ? { maxRetainedJobs } : {}),
    now,
  });
  const idempotencyIndex = new Map<string, string>();
  const externalJobIds = new Map<string, string>();

  return {
    kind: "pg-boss",
    cancel: async (jobId, reason) => {
      await inline.cancel(jobId, reason);
      await clearIdempotencyForJob(inline, idempotencyIndex, jobId);
      await cancelExternalJob(boss, externalJobIds.get(jobId));
    },
    complete: async (jobId) => {
      await inline.complete(jobId);
      await clearIdempotencyForJob(inline, idempotencyIndex, jobId);
      await completeExternalJob(boss, externalJobIds.get(jobId));
    },
    dequeue: async (input: DequeueJobsInput) => {
      const jobs = await inline.dequeue(input);
      return jobs.map((job) => withExternalJobId(job, externalJobIds));
    },
    enqueue: async (input: EnqueueJobInput) => {
      const existingId = input.idempotencyKey
        ? idempotencyIndex.get(input.idempotencyKey)
        : undefined;
      const job = await inline.enqueue(input);

      if (input.idempotencyKey) {
        idempotencyIndex.set(input.idempotencyKey, job.id);
      }

      if (existingId === job.id) {
        return withExternalJobId(job, externalJobIds);
      }

      try {
        await sendBossJob(boss, job, input, externalJobIds);
      } catch (error) {
        await inline.cancel(job.id, "pg-boss delivery failed");

        if (input.idempotencyKey && idempotencyIndex.get(input.idempotencyKey) === job.id) {
          idempotencyIndex.delete(input.idempotencyKey);
        }

        throw error;
      }

      return withExternalJobId(job, externalJobIds);
    },
    fail: async (jobId, error, options?: FailJobOptions) => {
      await inline.fail(jobId, error, options);
      if (options?.retryAt === undefined) {
        await clearIdempotencyForJob(inline, idempotencyIndex, jobId);
      }
      await failExternalJob(boss, externalJobIds.get(jobId), error);
    },
    heartbeat: async (input: HeartbeatJobInput) => {
      const job = await inline.heartbeat(input);
      return withExternalJobId(job, externalJobIds);
    },
    health: async () => true,
    lease: async (input: LeaseJobsInput) => {
      const jobs = await inline.lease(input);
      return jobs.map((job) => withExternalJobId(job, externalJobIds));
    },
    retry: async (jobId, options?: RetryJobOptions) => {
      await inline.retry(jobId, options);
      const job = await inline.status(jobId);

      if (!job) {
        return;
      }

      try {
        await sendBossJob(
          boss,
          job,
          {
            payload: job.payload,
            ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
            ...(options?.runAfter !== undefined ? { runAfter: options.runAfter } : {}),
            type: job.type,
          },
          externalJobIds,
        );
      } catch (error) {
        await inline.fail(job.id, "pg-boss retry delivery failed");
        throw error;
      }
    },
    stats: async () => inline.stats(),
    status: async (jobId) => {
      const job = await inline.status(jobId);
      return job ? withExternalJobId(job, externalJobIds) : null;
    },
  };
}

async function clearIdempotencyForJob(
  queue: JobQueueAdapter,
  idempotencyIndex: Map<string, string>,
  jobId: string,
): Promise<void> {
  const job = await queue.status(jobId);

  if (job?.idempotencyKey && idempotencyIndex.get(job.idempotencyKey) === job.id) {
    idempotencyIndex.delete(job.idempotencyKey);
  }
}

function createNoopPgBossClient(): PgBossClient {
  let nextId = 1;

  return {
    send: async () => {
      const id = `pg-boss-local-${nextId}`;
      nextId += 1;
      return id;
    },
  };
}

async function sendBossJob(
  boss: PgBossClient,
  job: JobRecord,
  input: EnqueueJobInput,
  externalJobIds: Map<string, string>,
): Promise<void> {
  const result = await boss.send(input.type, toPgBossMessage(job), toPgBossOptions(input));
  const bossJobId = typeof result === "string" ? result : result.id;
  externalJobIds.set(job.id, bossJobId);
}

function toPgBossMessage(job: JobRecord) {
  return {
    attempts: job.attempts,
    id: job.id,
    ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
    type: job.type,
  };
}

function toPgBossOptions(
  input: EnqueueJobInput,
): { readonly singletonKey?: string; readonly startAfter?: Date } | undefined {
  const options = {
    ...(input.idempotencyKey ? { singletonKey: input.idempotencyKey } : {}),
    ...(input.runAfter !== undefined ? { startAfter: new Date(input.runAfter) } : {}),
  };

  return Object.keys(options).length > 0 ? options : undefined;
}

function withExternalJobId(job: JobRecord, externalJobIds: ReadonlyMap<string, string>): JobRecord {
  const externalJobId = externalJobIds.get(job.id);

  return externalJobId ? { ...job, externalJobId } : job;
}

async function completeExternalJob(
  boss: PgBossClient,
  bossJobId: string | undefined,
): Promise<void> {
  if (bossJobId && boss.complete) {
    await boss.complete(bossJobId);
  }
}

async function failExternalJob(
  boss: PgBossClient,
  bossJobId: string | undefined,
  error: string,
): Promise<void> {
  if (bossJobId && boss.fail) {
    await boss.fail(bossJobId, error);
  }
}

async function cancelExternalJob(boss: PgBossClient, bossJobId: string | undefined): Promise<void> {
  if (bossJobId && boss.cancel) {
    await boss.cancel(bossJobId);
  }
}
