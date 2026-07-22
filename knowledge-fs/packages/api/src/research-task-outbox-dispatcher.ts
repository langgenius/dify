import { randomUUID } from "node:crypto";

import type { JobQueueAdapter } from "@knowledge/core";

import type {
  ResearchTaskDurableRepository,
  ResearchTaskOutboxEvent,
} from "./research-task-durable-repository";

export interface ResearchTaskOutboxDispatcherOptions {
  readonly generateLockToken?: (() => string) | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly intervalMs: number;
  readonly jobs: Pick<JobQueueAdapter, "enqueue">;
  readonly lockMs: number;
  readonly maxBatchSize: number;
  readonly maxDispatchAttempts: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly outbox?: ResearchTaskOutboxEvent }) => void)
    | undefined;
  readonly repository: Pick<
    ResearchTaskDurableRepository,
    "claimOutbox" | "markOutboxDispatched" | "releaseOutbox"
  >;
  readonly workerId: string;
}

export interface ResearchTaskOutboxDispatcher {
  start(): void;
  stop(): void;
  tick(): Promise<{
    readonly dispatched: number;
    readonly failed: number;
    readonly leased: number;
  }>;
}

export function createResearchTaskOutboxDispatcher({
  generateLockToken = randomUUID,
  initialRetryDelayMs = 1_000,
  intervalMs,
  jobs,
  lockMs,
  maxBatchSize,
  maxDispatchAttempts,
  maxRetryDelayMs = 5 * 60_000,
  now = Date.now,
  onError,
  repository,
  workerId,
}: ResearchTaskOutboxDispatcherOptions): ResearchTaskOutboxDispatcher {
  for (const [field, value] of [
    ["intervalMs", intervalMs],
    ["lockMs", lockMs],
    ["maxBatchSize", maxBatchSize],
    ["maxDispatchAttempts", maxDispatchAttempts],
    ["initialRetryDelayMs", initialRetryDelayMs],
    ["maxRetryDelayMs", maxRetryDelayMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Research task outbox ${field} must be a positive integer`);
    }
  }
  if (initialRetryDelayMs > maxRetryDelayMs) {
    throw new Error("Research task outbox initialRetryDelayMs must not exceed maxRetryDelayMs");
  }
  if (!workerId.trim()) {
    throw new Error("Research task outbox workerId must not be empty");
  }

  let activeTick:
    | Promise<{ readonly dispatched: number; readonly failed: number; readonly leased: number }>
    | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (activeTick) {
      return activeTick;
    }
    activeTick = (async () => {
      const timestamp = now();
      const lockToken = generateLockToken();
      const events = await repository.claimOutbox({
        limit: maxBatchSize,
        lockedUntil: timestamp + lockMs,
        lockToken,
        now: timestamp,
        workerId,
      });
      let dispatched = 0;
      let failed = 0;
      for (const event of events) {
        try {
          const queueJob = await jobs.enqueue({
            idempotencyKey: event.idempotencyKey,
            payload: event.payload,
            type: "research.task",
          });
          const marked = await repository.markOutboxDispatched({
            deliveredAt: now(),
            lockToken,
            now: now(),
            outboxId: event.id,
            queueJobId: queueJob.id,
          });
          if (!marked) {
            throw new Error("Research task outbox dispatch fence was lost");
          }
          dispatched += 1;
        } catch (error) {
          failed += 1;
          onError?.({ error, outbox: event });
          const timestampAfterFailure = now();
          const deadLetter = event.dispatchAttempts >= maxDispatchAttempts;
          try {
            await repository.releaseOutbox({
              availableAt:
                timestampAfterFailure +
                retryDelay(event.dispatchAttempts, initialRetryDelayMs, maxRetryDelayMs),
              deadLetter,
              error: errorMessage(error),
              lockToken,
              now: timestampAfterFailure,
              outboxId: event.id,
            });
          } catch (releaseError) {
            onError?.({ error: releaseError, outbox: event });
          }
        }
      }
      return { dispatched, failed, leased: events.length };
    })().finally(() => {
      activeTick = undefined;
    });
    return activeTick;
  };

  return {
    start() {
      if (timer) {
        return;
      }
      void tick().catch((error) => onError?.({ error }));
      timer = setInterval(() => {
        void tick().catch((error) => onError?.({ error }));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    tick,
  };
}

function retryDelay(attempt: number, initial: number, maximum: number): number {
  return Math.min(maximum, initial * 2 ** Math.max(0, attempt - 1));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Research task outbox dispatch failed";
}
