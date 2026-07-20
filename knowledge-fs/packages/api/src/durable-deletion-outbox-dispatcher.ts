import { randomUUID } from "node:crypto";

import type {
  DurableDeletionOutboxEvent,
  DurableDeletionRepository,
} from "./durable-deletion-repository";

export interface DurableDeletionOutboxDispatcherOptions {
  readonly generateLockToken?: (() => string) | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly intervalMs: number;
  readonly lockMs: number;
  readonly maxBatchSize: number;
  readonly maxDispatchAttempts: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly outbox?: DurableDeletionOutboxEvent }) => void)
    | undefined;
  readonly repository: Pick<
    DurableDeletionRepository,
    "claimOutbox" | "markOutboxDispatched" | "releaseOutbox"
  >;
  readonly wakeSink: DurableDeletionWakeSink;
  readonly workerId: string;
}

/**
 * A wake sink must not leave unconsumed queue records. Production uses the DB-polling sink: the
 * following markOutboxDispatched transaction itself moves the durable job to queued.
 */
export interface DurableDeletionWakeSink {
  notify(event: DurableDeletionOutboxEvent): Promise<{ readonly id: string }>;
}

export function createDatabasePollingDurableDeletionWakeSink(): DurableDeletionWakeSink {
  return {
    notify: async (event) => ({ id: `db-poll:${event.id}:${event.deliveryRevision}` }),
  };
}

export interface DurableDeletionOutboxDispatcher {
  start(): void;
  stop(): void;
  tick(): Promise<{
    readonly dispatched: number;
    readonly failed: number;
    readonly leased: number;
  }>;
}

export function createDurableDeletionOutboxDispatcher({
  generateLockToken = randomUUID,
  initialRetryDelayMs = 1_000,
  intervalMs,
  lockMs,
  maxBatchSize,
  maxDispatchAttempts,
  maxRetryDelayMs = 5 * 60_000,
  now = Date.now,
  onError,
  repository,
  wakeSink,
  workerId,
}: DurableDeletionOutboxDispatcherOptions): DurableDeletionOutboxDispatcher {
  for (const [field, value] of [
    ["intervalMs", intervalMs],
    ["lockMs", lockMs],
    ["maxBatchSize", maxBatchSize],
    ["maxDispatchAttempts", maxDispatchAttempts],
    ["initialRetryDelayMs", initialRetryDelayMs],
    ["maxRetryDelayMs", maxRetryDelayMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Durable deletion outbox ${field} must be a positive integer`);
    }
  }
  if (initialRetryDelayMs > maxRetryDelayMs) {
    throw new Error("Durable deletion outbox initialRetryDelayMs must not exceed maxRetryDelayMs");
  }
  if (!workerId.trim()) {
    throw new Error("Durable deletion outbox workerId must not be empty");
  }

  let activeTick:
    | Promise<{ readonly dispatched: number; readonly failed: number; readonly leased: number }>
    | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (activeTick) return activeTick;
    activeTick = (async () => {
      const timestamp = now();
      const lockToken = generateLockToken();
      const events = await repository.claimOutbox({
        limit: maxBatchSize,
        lockedUntil: iso(timestamp + lockMs),
        lockToken,
        now: iso(timestamp),
        workerId,
      });
      let dispatched = 0;
      let failed = 0;
      for (const event of events) {
        try {
          const wake = await wakeSink.notify(event);
          const markedAt = now();
          const marked = await repository.markOutboxDispatched({
            deliveredAt: iso(markedAt),
            lockToken,
            now: iso(markedAt),
            outboxId: event.id,
            queueJobId: wake.id,
          });
          if (!marked) throw new Error("Durable deletion outbox dispatch fence was lost");
          dispatched += 1;
        } catch (error) {
          failed += 1;
          onError?.({ error, outbox: event });
          const failedAt = now();
          try {
            await repository.releaseOutbox({
              availableAt: iso(
                failedAt + retryDelay(event.dispatchAttempts, initialRetryDelayMs, maxRetryDelayMs),
              ),
              deadLetter: event.dispatchAttempts >= maxDispatchAttempts,
              error: errorMessage(error),
              lockToken,
              now: iso(failedAt),
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

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function retryDelay(attempt: number, initial: number, maximum: number): number {
  return Math.min(maximum, initial * 2 ** Math.max(0, attempt - 1));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Durable deletion outbox dispatch failed";
}
