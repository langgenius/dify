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

export interface CloudflareQueueBinding {
  send(body: unknown, options?: { readonly delaySeconds?: number }): Promise<void>;
}

export interface CloudflareJobStateStore {
  put(jobId: string, record: JobRecord): Promise<void>;
}

export interface CloudflareJobQueueAdapterOptions {
  readonly maxBatchSize: number;
  readonly maxLeaseMs?: number;
  readonly maxQueuedJobs: number;
  readonly maxRetainedJobs?: number;
  readonly now?: () => number;
  readonly queue?: CloudflareQueueBinding;
  readonly state?: CloudflareJobStateStore;
}

export function createCloudflareJobQueueAdapter({
  maxBatchSize,
  maxLeaseMs,
  maxQueuedJobs,
  maxRetainedJobs,
  now = Date.now,
  queue = createNoopCloudflareQueueBinding(),
  state = createNoopCloudflareJobStateStore(),
}: CloudflareJobQueueAdapterOptions): JobQueueAdapter {
  const inline = createInlineJobQueueAdapter({
    kind: "cloudflare-queues",
    maxBatchSize,
    ...(maxLeaseMs !== undefined ? { maxLeaseMs } : {}),
    maxQueuedJobs,
    ...(maxRetainedJobs !== undefined ? { maxRetainedJobs } : {}),
    now,
  });
  const idempotencyIndex = new Map<string, string>();

  return {
    kind: "cloudflare-queues",
    cancel: async (jobId, reason) => {
      await inline.cancel(jobId, reason);
      await clearIdempotencyForJob(inline, idempotencyIndex, jobId);
      await persistIfPresent(state, inline, jobId);
    },
    complete: async (jobId) => {
      await inline.complete(jobId);
      await clearIdempotencyForJob(inline, idempotencyIndex, jobId);
      await persistIfPresent(state, inline, jobId);
    },
    dequeue: async (input: DequeueJobsInput) => {
      const jobs = await inline.dequeue(input);
      await persistMany(state, jobs);
      return jobs;
    },
    enqueue: async (input: EnqueueJobInput) => {
      const existingId = input.idempotencyKey
        ? idempotencyIndex.get(input.idempotencyKey)
        : undefined;
      const job = await inline.enqueue(input);
      await state.put(job.id, job);

      if (input.idempotencyKey) {
        idempotencyIndex.set(input.idempotencyKey, job.id);
      }

      if (existingId === job.id) {
        return job;
      }

      try {
        await queue.send(toCloudflareQueueMessage(job), toCloudflareQueueOptions(input, now()));
      } catch (error) {
        await inline.cancel(job.id, "Cloudflare queue delivery failed");
        await persistIfPresent(state, inline, job.id);

        if (input.idempotencyKey && idempotencyIndex.get(input.idempotencyKey) === job.id) {
          idempotencyIndex.delete(input.idempotencyKey);
        }

        throw error;
      }
      return job;
    },
    fail: async (jobId, error, options?: FailJobOptions) => {
      await inline.fail(jobId, error, options);
      if (options?.retryAt === undefined) {
        await clearIdempotencyForJob(inline, idempotencyIndex, jobId);
      }
      await persistIfPresent(state, inline, jobId);
    },
    heartbeat: async (input: HeartbeatJobInput) => {
      const job = await inline.heartbeat(input);
      await state.put(job.id, job);
      return job;
    },
    health: async () => inline.health(),
    lease: async (input: LeaseJobsInput) => {
      const jobs = await inline.lease(input);
      await persistMany(state, jobs);
      return jobs;
    },
    retry: async (jobId, options?: RetryJobOptions) => {
      await inline.retry(jobId, options);
      const job = await inline.status(jobId);

      if (job) {
        await state.put(job.id, job);
        await queue.send(
          toCloudflareQueueMessage(job),
          toCloudflareDelayOptions(options?.runAfter, now()),
        );
      }
    },
    stats: async () => inline.stats(),
    status: async (jobId) => inline.status(jobId),
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

function createNoopCloudflareQueueBinding(): CloudflareQueueBinding {
  return {
    send: async () => undefined,
  };
}

function createNoopCloudflareJobStateStore(): CloudflareJobStateStore {
  return {
    put: async () => undefined,
  };
}

function toCloudflareQueueMessage(job: JobRecord) {
  return {
    attempts: job.attempts,
    id: job.id,
    ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
    type: job.type,
  };
}

function toCloudflareQueueOptions(
  input: EnqueueJobInput,
  timestamp: number,
): { readonly delaySeconds?: number } | undefined {
  return toCloudflareDelayOptions(input.runAfter, timestamp);
}

function toCloudflareDelayOptions(
  runAfter: number | undefined,
  timestamp: number,
): { readonly delaySeconds?: number } | undefined {
  if (runAfter === undefined || runAfter <= timestamp) {
    return undefined;
  }

  return {
    delaySeconds: Math.ceil((runAfter - timestamp) / 1_000),
  };
}

async function persistMany(
  state: CloudflareJobStateStore,
  jobs: readonly JobRecord[],
): Promise<void> {
  await Promise.all(jobs.map((job) => state.put(job.id, job)));
}

async function persistIfPresent(
  state: CloudflareJobStateStore,
  queue: JobQueueAdapter,
  jobId: string,
): Promise<void> {
  const job = await queue.status(jobId);

  if (job) {
    await state.put(job.id, job);
  }
}
