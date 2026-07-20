import type { DurableDeletionJob, DurableDeletionRepository } from "./durable-deletion-repository";
import {
  DurableDeletionProcessorLeaseLostError,
  type DurableDeletionTargetProcessResult,
  type DurableDeletionTargetProcessors,
} from "./durable-deletion-target-processors";

export interface DurableDeletionRuntimeRepository
  extends Pick<
    DurableDeletionRepository,
    "claimJobs" | "failJob" | "heartbeatJob" | "scheduleJobRetry"
  > {}

export interface DurableDeletionRuntimeErrorClassification {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface DurableDeletionRuntimeOptions {
  readonly classifyError?:
    | ((error: unknown, job: DurableDeletionJob) => DurableDeletionRuntimeErrorClassification)
    | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly maxBatchSize: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly maxStepsPerLease?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly job?: DurableDeletionJob }) => void)
    | undefined;
  readonly processor: DurableDeletionTargetProcessors;
  readonly repository: DurableDeletionRuntimeRepository;
  /**
   * Hard deadline for one processor step. It must be shorter than the heartbeat interval so a
   * worker never executes a long, unfenced step after its lease may have expired. Target
   * capabilities must honor the supplied AbortSignal; external deletion must also be idempotent.
   */
  readonly stepTimeoutMs: number;
  readonly workerId: string;
}

export interface DurableDeletionRuntimeTickResult {
  readonly completed: number;
  readonly deferred: number;
  readonly failed: number;
  readonly leased: number;
  readonly retryScheduled: number;
}

export interface DurableDeletionRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<DurableDeletionRuntimeTickResult>;
}

export function createDurableDeletionRuntime({
  classifyError = defaultErrorClassification,
  heartbeatIntervalMs = 10_000,
  initialRetryDelayMs = 1_000,
  intervalMs,
  leaseMs,
  maxBatchSize,
  maxRetryDelayMs = 5 * 60_000,
  maxStepsPerLease = 100,
  now = Date.now,
  onError,
  processor,
  repository,
  stepTimeoutMs,
  workerId,
}: DurableDeletionRuntimeOptions): DurableDeletionRuntime {
  for (const [field, value] of [
    ["intervalMs", intervalMs],
    ["leaseMs", leaseMs],
    ["maxBatchSize", maxBatchSize],
    ["heartbeatIntervalMs", heartbeatIntervalMs],
    ["initialRetryDelayMs", initialRetryDelayMs],
    ["maxRetryDelayMs", maxRetryDelayMs],
    ["maxStepsPerLease", maxStepsPerLease],
    ["stepTimeoutMs", stepTimeoutMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Durable deletion runtime ${field} must be a positive integer`);
    }
  }
  if (heartbeatIntervalMs >= leaseMs) {
    throw new Error("Durable deletion runtime heartbeatIntervalMs must be less than leaseMs");
  }
  if (stepTimeoutMs >= heartbeatIntervalMs) {
    throw new Error("Durable deletion runtime stepTimeoutMs must be less than heartbeatIntervalMs");
  }
  if (typeof repository.failJob !== "function") {
    throw new Error("Durable deletion runtime repository.failJob is required");
  }
  if (!workerId.trim()) throw new Error("Durable deletion runtime workerId must not be empty");

  let activeTick: Promise<DurableDeletionRuntimeTickResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<DurableDeletionRuntimeTickResult> => {
    if (activeTick) return activeTick;
    activeTick = (async () => {
      const claimedAt = now();
      const jobs = await repository.claimJobs({
        leaseExpiresAt: iso(claimedAt + leaseMs),
        limit: maxBatchSize,
        now: iso(claimedAt),
        workerId,
      });
      const totals = {
        completed: 0,
        deferred: 0,
        failed: 0,
        leased: jobs.length,
        retryScheduled: 0,
      };
      for (const claimed of jobs) {
        let current = claimed;
        try {
          let terminal = false;
          for (let step = 0; step < maxStepsPerLease; step += 1) {
            const heartbeatAt = now();
            current = await requireJob(
              repository.heartbeatJob({
                ...fence(current, heartbeatAt),
                leaseExpiresAt: iso(heartbeatAt + leaseMs),
                workerId,
              }),
            );
            const result = await processWithDeadline(processor, current, stepTimeoutMs);
            current = result.job;
            if (result.disposition === "completed") {
              totals.completed += 1;
              terminal = true;
              break;
            }
            if (result.disposition === "failed") {
              await requireJob(
                repository.failJob({
                  ...fence(current, now()),
                  errorCode: result.error.code,
                  errorMessage: result.error.message,
                }),
              );
              totals.failed += 1;
              terminal = true;
              break;
            }
            if (result.disposition === "failed_persisted") {
              totals.failed += 1;
              terminal = true;
              break;
            }
            if (result.disposition === "waiting") {
              const cooperative = result.attemptBudget === "cooperative";
              const scheduled = await requireJob(
                repository.scheduleJobRetry({
                  ...fence(current, now()),
                  errorCode: cooperative
                    ? "DURABLE_DELETION_COOPERATIVE_WAIT"
                    : "DURABLE_DELETION_ITEM_RETRY_WAIT",
                  errorMessage: cooperative
                    ? "Durable deletion is waiting for bounded scoped work to drain"
                    : "Durable deletion is waiting to retry a failed external item",
                  ...(cooperative ? { resetExecutionAttempts: true } : {}),
                  retryAt: result.retryAt,
                }),
              );
              if (scheduled.runState === "failed") totals.failed += 1;
              else totals.retryScheduled += 1;
              terminal = true;
              break;
            }
          }
          if (!terminal) {
            const scheduled = await requireJob(
              repository.scheduleJobRetry({
                ...fence(current, now()),
                errorCode: "DURABLE_DELETION_COOPERATIVE_YIELD",
                errorMessage: "Durable deletion yielded after its bounded step budget",
                resetExecutionAttempts: true,
                retryAt: iso(now() + initialRetryDelayMs),
              }),
            );
            if (scheduled.runState === "failed") totals.failed += 1;
            else totals.retryScheduled += 1;
          }
        } catch (error) {
          if (error instanceof DurableDeletionProcessorLeaseLostError) {
            totals.deferred += 1;
            continue;
          }
          onError?.({ error, job: current });
          const classification = classifyError(error, current);
          try {
            if (
              classification.retryable &&
              current.executionAttempts < current.maxExecutionAttempts
            ) {
              const scheduled = await requireJob(
                repository.scheduleJobRetry({
                  ...fence(current, now()),
                  errorCode: classification.code,
                  errorMessage: classification.message,
                  retryAt: iso(
                    now() +
                      retryDelay(current.executionAttempts, initialRetryDelayMs, maxRetryDelayMs),
                  ),
                }),
              );
              if (scheduled.runState === "failed") totals.failed += 1;
              else totals.retryScheduled += 1;
            } else {
              await requireJob(
                repository.failJob({
                  ...fence(current, now()),
                  errorCode: classification.code,
                  errorMessage: classification.message,
                }),
              );
              totals.failed += 1;
            }
          } catch (fenceError) {
            onError?.({ error: fenceError, job: current });
            totals.deferred += 1;
          }
        }
      }
      return totals;
    })().finally(() => {
      activeTick = undefined;
    });
    return activeTick;
  };

  return {
    start() {
      if (timer) return;
      void tick().catch((error) => onError?.({ error }));
      timer = setInterval(() => void tick().catch((error) => onError?.({ error })), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

async function processWithDeadline(
  processor: DurableDeletionTargetProcessors,
  job: DurableDeletionJob,
  timeoutMs: number,
): Promise<DurableDeletionTargetProcessResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      processor.process({ job, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort(new DurableDeletionStepTimeoutError(timeoutMs));
          reject(new DurableDeletionStepTimeoutError(timeoutMs));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class DurableDeletionStepTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Durable deletion processor step exceeded ${timeoutMs}ms`);
    this.name = "DurableDeletionStepTimeoutError";
  }
}

function fence(job: DurableDeletionJob, timestamp: number) {
  if (!job.leaseToken) throw new DurableDeletionProcessorLeaseLostError();
  return {
    deletionJobId: job.id,
    expectedRowVersion: job.rowVersion,
    leaseToken: job.leaseToken,
    now: iso(timestamp),
  };
}

async function requireJob(value: Promise<DurableDeletionJob | null>): Promise<DurableDeletionJob> {
  const result = await value;
  if (!result) throw new DurableDeletionProcessorLeaseLostError();
  return result;
}

function retryDelay(attempt: number, initial: number, maximum: number): number {
  return Math.min(maximum, initial * 2 ** Math.max(0, attempt - 1));
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function defaultErrorClassification(error: unknown): DurableDeletionRuntimeErrorClassification {
  return {
    code: "DURABLE_DELETION_PROCESSING_FAILED",
    message: error instanceof Error ? error.message : "Durable deletion processing failed",
    retryable: true,
  };
}
