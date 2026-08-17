import {
  type JobPayload,
  type JobQueueAdapter,
  ProjectionSetFingerprintSchema,
  UuidSchema,
} from "@knowledge/core";

import type { DocumentCompilationAttemptRepository } from "./document-compilation-attempt-repository";
import type { PageIndexFindabilityPublicationEvaluator } from "./page-index-findability-publication";

export const PageIndexFindabilityJobType = "quality.page-index-findability" as const;

export interface PageIndexFindabilityAdmission {
  enqueue(input: {
    readonly compilationAttemptId: string;
    readonly publicationFingerprint: string;
  }): Promise<void>;
}

export interface PageIndexFindabilityRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<{
    readonly claimed: number;
    readonly failed: number;
    readonly retried: number;
    readonly succeeded: number;
  }>;
}

export interface PageIndexFindabilityRuntimeOptions {
  readonly attempts: Pick<DocumentCompilationAttemptRepository, "get">;
  readonly circuitBreakerFailureThreshold?: number | undefined;
  readonly circuitBreakerResetMs?: number | undefined;
  readonly evaluator: PageIndexFindabilityPublicationEvaluator;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly intervalMs: number;
  readonly jobs: Pick<JobQueueAdapter, "complete" | "enqueue" | "fail" | "heartbeat" | "lease">;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly maxBatchSize: number;
  readonly now?: (() => number) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly workerId: string;
}

/**
 * Publication only enqueues a small durable receipt. Golden-question sampling and all model calls
 * happen here, outside the document compilation critical path. Repeated dependency failures open a
 * process-local breaker so a provider outage cannot drain the shared model budget.
 */
export function createPageIndexFindabilityRuntime({
  attempts,
  circuitBreakerFailureThreshold = 3,
  circuitBreakerResetMs = 60_000,
  evaluator,
  leaseMs,
  heartbeatIntervalMs = Math.max(1, Math.floor(leaseMs / 3)),
  intervalMs,
  jobs,
  maxAttempts,
  maxBatchSize,
  now = Date.now,
  onError,
  retryBaseMs,
  retryMaxMs,
  workerId,
}: PageIndexFindabilityRuntimeOptions): {
  readonly admission: PageIndexFindabilityAdmission;
  readonly runtime: PageIndexFindabilityRuntime;
} {
  for (const [name, value] of Object.entries({
    circuitBreakerFailureThreshold,
    circuitBreakerResetMs,
    heartbeatIntervalMs,
    intervalMs,
    leaseMs,
    maxAttempts,
    maxBatchSize,
    retryBaseMs,
    retryMaxMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`PageIndex findability runtime ${name} must be a positive integer`);
    }
  }
  if (heartbeatIntervalMs >= leaseMs) {
    throw new Error("PageIndex findability heartbeat interval must be below leaseMs");
  }
  if (!workerId.trim()) throw new Error("PageIndex findability workerId is required");

  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  const tick = async () => {
    if (ticking || now() < circuitOpenUntil) {
      return { claimed: 0, failed: 0, retried: 0, succeeded: 0 };
    }
    ticking = true;
    try {
      const leased = await jobs.lease({
        leaseMs,
        limit: maxBatchSize,
        now: now(),
        types: [PageIndexFindabilityJobType],
        workerId,
      });
      const counts = { claimed: leased.length, failed: 0, retried: 0, succeeded: 0 };
      await Promise.all(
        leased.map(async (job) => {
          const heartbeat = setInterval(
            () =>
              void jobs
                .heartbeat({ jobId: job.id, leaseMs, now: now(), workerId })
                .catch(() => undefined),
            heartbeatIntervalMs,
          );
          heartbeat.unref?.();
          try {
            const payload = parsePayload(job.payload);
            const attempt = await attempts.get(payload.compilationAttemptId);
            if (!attempt) throw new Error("Findability compilation attempt no longer exists");
            await evaluator.evaluatePublished({
              attempt,
              publicationFingerprint: payload.publicationFingerprint,
            });
            await jobs.complete(job.id);
            consecutiveFailures = 0;
            counts.succeeded += 1;
          } catch (error) {
            onError?.(error);
            consecutiveFailures += 1;
            if (consecutiveFailures >= circuitBreakerFailureThreshold) {
              circuitOpenUntil = now() + circuitBreakerResetMs;
              consecutiveFailures = 0;
            }
            if (job.attempts < maxAttempts) {
              await jobs.fail(job.id, boundedError(error), {
                retryAt: now() + retryDelay(retryBaseMs, retryMaxMs, job.attempts),
              });
              counts.retried += 1;
            } else {
              await jobs.fail(job.id, boundedError(error));
              counts.failed += 1;
            }
          } finally {
            clearInterval(heartbeat);
          }
        }),
      );
      return counts;
    } finally {
      ticking = false;
    }
  };

  return {
    admission: {
      enqueue: async ({ compilationAttemptId, publicationFingerprint }) => {
        const attemptId = UuidSchema.parse(compilationAttemptId);
        const fingerprint = ProjectionSetFingerprintSchema.parse(publicationFingerprint);
        await jobs.enqueue({
          idempotencyKey: `page-index-findability:${attemptId}:${fingerprint}`,
          payload: { compilationAttemptId: attemptId, publicationFingerprint: fingerprint },
          priority: "low",
          type: PageIndexFindabilityJobType,
        });
      },
    },
    runtime: {
      start: () => {
        if (timer) return;
        void tick().catch(onError ?? (() => undefined));
        timer = setInterval(() => void tick().catch(onError ?? (() => undefined)), intervalMs);
        timer.unref?.();
      },
      stop: () => {
        if (!timer) return;
        clearInterval(timer);
        timer = undefined;
      },
      tick,
    },
  };
}

function parsePayload(payload: JobPayload): {
  readonly compilationAttemptId: string;
  readonly publicationFingerprint: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("PageIndex findability job payload is invalid");
  }
  const record = payload as Readonly<Record<string, JobPayload>>;
  return {
    compilationAttemptId: UuidSchema.parse(record.compilationAttemptId),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(record.publicationFingerprint),
  };
}

function retryDelay(baseMs: number, maxMs: number, attempt: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : "Findability evaluation failed").slice(0, 2_000);
}
