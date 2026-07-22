import type {
  DequeueJobsInput,
  EnqueueJobInput,
  FailJobOptions,
  HeartbeatJobInput,
  JobPayload,
  JobQueueAdapter,
  JobQueueStats,
  JobRecord,
  JobStatus,
  LeaseJobsInput,
} from "@knowledge/core";

export interface InlineJobQueueOptions {
  readonly kind?: JobQueueAdapter["kind"];
  readonly maxBatchSize: number;
  readonly maxLeaseMs?: number;
  readonly maxQueuedJobs: number;
  readonly maxRetainedJobs?: number;
  readonly now?: () => number;
}

interface StoredJob {
  attempts: number;
  canceledAt: number | undefined;
  completedAt: number | undefined;
  createdAt: number;
  error: string | undefined;
  failedAt: number | undefined;
  heartbeatAt: number | undefined;
  id: string;
  idempotencyKey: string | undefined;
  leaseExpiresAt: number | undefined;
  payload: JobPayload;
  runAfter: number | undefined;
  startedAt: number | undefined;
  status: JobStatus;
  type: string;
  workerId: string | undefined;
}

export function createInlineJobQueueAdapter({
  kind = "inline",
  maxBatchSize,
  maxLeaseMs = 5 * 60 * 1_000,
  maxQueuedJobs,
  maxRetainedJobs = maxQueuedJobs,
  now = Date.now,
}: InlineJobQueueOptions): JobQueueAdapter {
  if (maxBatchSize < 1) {
    throw new Error("Inline job queue maxBatchSize must be at least 1");
  }

  if (maxQueuedJobs < 1) {
    throw new Error("Inline job queue maxQueuedJobs must be at least 1");
  }

  if (maxLeaseMs < 1) {
    throw new Error("Inline job queue maxLeaseMs must be at least 1");
  }

  if (maxRetainedJobs < 0) {
    throw new Error("Inline job queue maxRetainedJobs must be at least 0");
  }

  const jobs = new Map<string, StoredJob>();
  const idempotencyIndex = new Map<string, string>();
  let canceledCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let nextId = 1;

  return {
    kind,
    cancel: async (jobId, reason) => {
      const job = requireJob(jobs, jobId);
      job.status = "canceled";
      job.canceledAt = now();
      if (reason !== undefined) {
        job.error = reason;
      }
      job.workerId = undefined;
      job.leaseExpiresAt = undefined;
      canceledCount += 1;
      clearIdempotencyForJob(idempotencyIndex, job);
      pruneTerminalJobs(jobs, idempotencyIndex, maxRetainedJobs);
    },
    complete: async (jobId) => {
      const job = requireJob(jobs, jobId);
      job.status = "completed";
      job.completedAt = now();
      job.workerId = undefined;
      job.leaseExpiresAt = undefined;
      completedCount += 1;
      clearIdempotencyForJob(idempotencyIndex, job);
      pruneTerminalJobs(jobs, idempotencyIndex, maxRetainedJobs);
    },
    dequeue: async (input) => {
      return leaseReadyJobs(jobs, input, maxBatchSize, undefined, now());
    },
    enqueue: async (input) => {
      if (input.idempotencyKey) {
        const existingId = idempotencyIndex.get(input.idempotencyKey);

        if (existingId) {
          return toJobRecord(requireJob(jobs, existingId));
        }
      }

      if (countActiveJobs(jobs) >= maxQueuedJobs) {
        throw new Error(`Job queue maxQueuedJobs=${maxQueuedJobs} exceeded`);
      }

      const id = `job-${nextId}`;
      nextId += 1;

      const job: StoredJob = {
        attempts: 0,
        canceledAt: undefined,
        completedAt: undefined,
        createdAt: now(),
        error: undefined,
        failedAt: undefined,
        heartbeatAt: undefined,
        id,
        idempotencyKey: input.idempotencyKey,
        leaseExpiresAt: undefined,
        payload: clonePayload(input.payload),
        runAfter: input.runAfter,
        startedAt: undefined,
        status: "queued",
        type: input.type,
        workerId: undefined,
      };

      jobs.set(id, job);

      if (input.idempotencyKey) {
        idempotencyIndex.set(input.idempotencyKey, id);
      }

      return toJobRecord(job);
    },
    fail: async (jobId, error, options) => {
      const job = requireJob(jobs, jobId);
      job.error = error;
      job.failedAt = now();
      job.workerId = undefined;
      job.leaseExpiresAt = undefined;

      if (options?.retryAt !== undefined) {
        job.status = "queued";
        job.runAfter = options.retryAt;
        return;
      }

      job.status = "failed";
      failedCount += 1;
      clearIdempotencyForJob(idempotencyIndex, job);
      pruneTerminalJobs(jobs, idempotencyIndex, maxRetainedJobs);
    },
    heartbeat: async (input) => {
      validateLease(input, maxBatchSize, maxLeaseMs);
      const job = requireJob(jobs, input.jobId);

      if (job.status !== "running" || job.workerId !== input.workerId) {
        throw new Error(`Job ${input.jobId} is not leased by worker ${input.workerId}`);
      }

      const timestamp = input.now ?? now();
      job.heartbeatAt = timestamp;
      job.leaseExpiresAt = timestamp + input.leaseMs;
      return toJobRecord(job);
    },
    health: async () => true,
    lease: async (input) => leaseReadyJobs(jobs, input, maxBatchSize, maxLeaseMs, now()),
    retry: async (jobId, options) => {
      const job = requireJob(jobs, jobId);

      if (job.status === "completed" || job.status === "canceled") {
        throw new Error(`Job ${jobId} is terminal and cannot be retried`);
      }

      job.status = "queued";
      if (options?.runAfter !== undefined) {
        job.runAfter = options.runAfter;
      } else {
        job.runAfter = undefined;
      }
      job.workerId = undefined;
      job.leaseExpiresAt = undefined;
    },
    stats: async () => countJobsByStatus(jobs, canceledCount, completedCount, failedCount),
    status: async (jobId) => {
      const job = jobs.get(jobId);
      return job ? toJobRecord(job) : null;
    },
  };
}

function validateDequeueLimit({ limit }: DequeueJobsInput, maxBatchSize: number): void {
  if (limit < 1) {
    throw new Error("Job dequeue limit must be at least 1");
  }

  if (limit > maxBatchSize) {
    throw new Error(`Job dequeue limit exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateLease(
  input: LeaseJobsInput | HeartbeatJobInput,
  maxBatchSize: number,
  maxLeaseMs: number,
): void {
  if ("limit" in input) {
    validateDequeueLimit(input, maxBatchSize);
  }

  if (input.leaseMs < 1) {
    throw new Error("Job leaseMs must be at least 1");
  }

  if (input.leaseMs > maxLeaseMs) {
    throw new Error(`Job leaseMs exceeds maxLeaseMs=${maxLeaseMs}`);
  }
}

function leaseReadyJobs(
  jobs: ReadonlyMap<string, StoredJob>,
  input: DequeueJobsInput | LeaseJobsInput,
  maxBatchSize: number,
  maxLeaseMs: number | undefined,
  fallbackNow: number,
): readonly JobRecord[] {
  if (maxLeaseMs !== undefined) {
    validateLease(input as LeaseJobsInput, maxBatchSize, maxLeaseMs);
  } else {
    validateDequeueLimit(input, maxBatchSize);
  }

  const timestamp = input.now ?? fallbackNow;
  const leaseMs = "leaseMs" in input ? input.leaseMs : undefined;
  const dequeued: JobRecord[] = [];

  for (const job of jobs.values()) {
    if (dequeued.length >= input.limit) {
      break;
    }

    if (!matchesRequestedType(job, input.types) || !isReadyForLease(job, timestamp)) {
      continue;
    }

    job.status = "running";
    job.startedAt = timestamp;
    job.workerId = input.workerId;
    job.attempts += 1;
    job.heartbeatAt = undefined;
    if (leaseMs !== undefined) {
      job.leaseExpiresAt = timestamp + leaseMs;
    } else {
      job.leaseExpiresAt = undefined;
    }
    dequeued.push(toJobRecord(job));
  }

  return dequeued;
}

function matchesRequestedType(job: StoredJob, types: readonly string[] | undefined): boolean {
  return types === undefined || types.includes(job.type);
}

function isReadyForLease(job: StoredJob, timestamp: number): boolean {
  if (job.status === "queued") {
    return job.runAfter === undefined || job.runAfter <= timestamp;
  }

  return (
    job.status === "running" && job.leaseExpiresAt !== undefined && job.leaseExpiresAt <= timestamp
  );
}

function requireJob(jobs: ReadonlyMap<string, StoredJob>, jobId: string): StoredJob {
  const job = jobs.get(jobId);

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  return job;
}

function countActiveJobs(jobs: ReadonlyMap<string, StoredJob>): number {
  let activeJobs = 0;

  for (const job of jobs.values()) {
    if (job.status === "queued" || job.status === "running") {
      activeJobs += 1;
    }
  }

  return activeJobs;
}

function countJobsByStatus(
  jobs: ReadonlyMap<string, StoredJob>,
  canceledCount: number,
  completedCount: number,
  failedCount: number,
): JobQueueStats {
  const counts = {
    canceled: canceledCount,
    completed: completedCount,
    failed: failedCount,
    queued: 0,
    running: 0,
  };

  for (const job of jobs.values()) {
    if (job.status === "queued" || job.status === "running") {
      counts[job.status] += 1;
    }
  }

  return counts;
}

function pruneTerminalJobs(
  jobs: Map<string, StoredJob>,
  idempotencyIndex: Map<string, string>,
  maxRetainedJobs: number,
): void {
  const terminalJobs = [...jobs.values()].filter(
    (job) => job.status === "completed" || job.status === "failed" || job.status === "canceled",
  );
  const pruneCount = terminalJobs.length - maxRetainedJobs;

  if (pruneCount <= 0) {
    return;
  }

  for (const job of terminalJobs.slice(0, pruneCount)) {
    jobs.delete(job.id);
    clearIdempotencyForJob(idempotencyIndex, job);
  }
}

function clearIdempotencyForJob(idempotencyIndex: Map<string, string>, job: StoredJob): void {
  if (job.idempotencyKey && idempotencyIndex.get(job.idempotencyKey) === job.id) {
    idempotencyIndex.delete(job.idempotencyKey);
  }
}

function toJobRecord(job: StoredJob): JobRecord {
  return {
    attempts: job.attempts,
    ...(job.canceledAt !== undefined ? { canceledAt: job.canceledAt } : {}),
    createdAt: job.createdAt,
    id: job.id,
    payload: clonePayload(job.payload),
    status: job.status,
    type: job.type,
    ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.failedAt !== undefined ? { failedAt: job.failedAt } : {}),
    ...(job.heartbeatAt !== undefined ? { heartbeatAt: job.heartbeatAt } : {}),
    ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
    ...(job.leaseExpiresAt !== undefined ? { leaseExpiresAt: job.leaseExpiresAt } : {}),
    ...(job.runAfter !== undefined ? { runAfter: job.runAfter } : {}),
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    ...(job.workerId ? { workerId: job.workerId } : {}),
  };
}

function clonePayload(payload: JobPayload): JobPayload {
  return JSON.parse(JSON.stringify(payload)) as JobPayload;
}
