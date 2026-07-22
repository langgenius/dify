import { randomUUID } from "node:crypto";

import type { JobQueueAdapter } from "@knowledge/core";

import {
  type DocumentCompilationAttemptRepository,
  type DocumentCompilationOutboxEvent,
  DocumentCompilationOutboxEventType,
  DocumentCompilationOutboxSchemaVersion,
} from "./document-compilation-attempt-repository";

export interface DocumentCompilationOutboxDispatcherOptions {
  readonly attempts: Pick<
    DocumentCompilationAttemptRepository,
    "claimOutbox" | "markOutboxDispatched" | "releaseOutbox"
  >;
  readonly generateLockToken?: (() => string) | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly intervalMs: number;
  readonly jobs: Pick<JobQueueAdapter, "enqueue">;
  readonly lockMs: number;
  readonly maxBatchSize: number;
  readonly maxDispatchAttempts?: number | undefined;
  readonly maxRetryDelayMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly outbox?: DocumentCompilationOutboxEvent;
      }) => void)
    | undefined;
  /** Re-publish a dispatched/leased event if no durable terminal/heartbeat update occurs. */
  readonly visibilityMs?: number | undefined;
  readonly workerId: string;
}

export interface DocumentCompilationOutboxDispatchTickResult {
  readonly claimed: number;
  readonly deadLettered: number;
  readonly dispatched: number;
  readonly released: number;
  /** Enqueue succeeded, but the database delivery marker lost its fence or could not be written. */
  readonly unconfirmed: number;
}

export interface DocumentCompilationOutboxDispatcher {
  /** Starts periodic dispatching. Calling start more than once is harmless. */
  start(): void;
  /** Stops future periodic ticks. An already-running tick is allowed to finish. */
  stop(): void;
  /** Runs one non-overlapping dispatch pass. */
  tick(): Promise<DocumentCompilationOutboxDispatchTickResult>;
}

const defaultInitialRetryDelayMs = 1_000;
const defaultMaxRetryDelayMs = 60_000;
const defaultMaxDispatchAttempts = 10;

/**
 * Publishes durable document-compilation outbox events to the platform queue.
 *
 * The outbox row is the authority for both the queue payload and idempotency key. An enqueue is
 * deliberately performed before the row is marked dispatched. If that marker cannot be persisted,
 * the row remains reclaimable and may be delivered again; queue idempotency plus the runtime's
 * terminal-attempt acknowledgement make that at-least-once boundary safe.
 */
export function createDocumentCompilationOutboxDispatcher({
  attempts,
  generateLockToken = randomUUID,
  initialRetryDelayMs = defaultInitialRetryDelayMs,
  intervalMs,
  jobs,
  lockMs,
  maxBatchSize,
  maxDispatchAttempts = defaultMaxDispatchAttempts,
  maxRetryDelayMs = defaultMaxRetryDelayMs,
  now = Date.now,
  onError,
  visibilityMs = lockMs,
  workerId,
}: DocumentCompilationOutboxDispatcherOptions): DocumentCompilationOutboxDispatcher {
  validatePositiveInteger(intervalMs, "intervalMs");
  validatePositiveInteger(lockMs, "lockMs");
  validatePositiveInteger(maxBatchSize, "maxBatchSize");
  validatePositiveInteger(maxDispatchAttempts, "maxDispatchAttempts");
  validatePositiveInteger(initialRetryDelayMs, "initialRetryDelayMs");
  validatePositiveInteger(maxRetryDelayMs, "maxRetryDelayMs");
  validatePositiveInteger(visibilityMs, "visibilityMs");
  if (initialRetryDelayMs > maxRetryDelayMs) {
    throw new Error(
      "Document compilation outbox initialRetryDelayMs must not exceed maxRetryDelayMs",
    );
  }
  if (!workerId.trim()) {
    throw new Error("Document compilation outbox workerId must not be empty");
  }

  let activeTick: Promise<DocumentCompilationOutboxDispatchTickResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runTick(): Promise<DocumentCompilationOutboxDispatchTickResult> {
    const claimTime = validTimestamp(now(), "now");
    const lockToken = generateLockToken();
    const claimed = await attempts.claimOutbox({
      limit: maxBatchSize,
      lockedUntil: isoTimestamp(claimTime + lockMs),
      lockToken,
      now: isoTimestamp(claimTime),
      workerId,
    });
    const result = {
      claimed: claimed.length,
      deadLettered: 0,
      dispatched: 0,
      released: 0,
      unconfirmed: 0,
    };

    await Promise.all(
      claimed.map(async (event) => {
        let queueJob: Awaited<ReturnType<JobQueueAdapter["enqueue"]>>;

        try {
          assertDispatchableEvent(event, lockToken);
          queueJob = await jobs.enqueue({
            idempotencyKey: event.idempotencyKey,
            payload: { attemptId: event.attemptId },
            type: DocumentCompilationOutboxEventType,
          });
        } catch (error) {
          onError?.({ error, outbox: event });
          const releaseTime = validTimestamp(now(), "now");
          const deadLetter = event.dispatchAttempts >= maxDispatchAttempts;
          const retryDelayMs = exponentialDelay(
            initialRetryDelayMs,
            maxRetryDelayMs,
            event.dispatchAttempts,
          );

          try {
            const released = await attempts.releaseOutbox({
              availableAt: isoTimestamp(releaseTime + retryDelayMs),
              deadLetter: deadLetter,
              error: errorMessage(error),
              lockToken,
              now: isoTimestamp(releaseTime),
              outboxId: event.id,
            });
            if (released) {
              if (deadLetter) {
                result.deadLettered += 1;
              } else {
                result.released += 1;
              }
            } else {
              result.unconfirmed += 1;
            }
          } catch (releaseError) {
            result.unconfirmed += 1;
            onError?.({ error: releaseError, outbox: event });
          }
          return;
        }

        try {
          const deliveredAt = validTimestamp(now(), "now");
          const marked = await attempts.markOutboxDispatched({
            availableAt: isoTimestamp(deliveredAt + visibilityMs),
            deliveredAt: isoTimestamp(deliveredAt),
            ...(queueJob.externalJobId ? { externalJobId: queueJob.externalJobId } : {}),
            lockToken,
            now: isoTimestamp(deliveredAt),
            outboxId: event.id,
            queueJobId: queueJob.id,
          });

          if (marked) {
            result.dispatched += 1;
          } else {
            // Do not compensate an enqueue that already escaped. Let the lock expire and redeliver
            // the same persisted event/idempotency key.
            result.unconfirmed += 1;
          }
        } catch (error) {
          result.unconfirmed += 1;
          onError?.({ error, outbox: event });
        }
      }),
    );

    return result;
  }

  function tick(): Promise<DocumentCompilationOutboxDispatchTickResult> {
    if (activeTick) {
      return activeTick;
    }

    activeTick = runTick().finally(() => {
      activeTick = undefined;
    });
    return activeTick;
  }

  return {
    start: () => {
      if (timer) {
        return;
      }

      void tick().catch((error) => onError?.({ error }));
      timer = setInterval(() => {
        void tick().catch((error) => onError?.({ error }));
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
    },
    stop: () => {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

function assertDispatchableEvent(event: DocumentCompilationOutboxEvent, lockToken: string): void {
  if (
    event.eventType !== DocumentCompilationOutboxEventType ||
    event.schemaVersion !== DocumentCompilationOutboxSchemaVersion
  ) {
    throw new Error("Unsupported document compilation outbox event");
  }
  if (
    event.status !== "dispatching" ||
    event.lockToken !== lockToken ||
    event.payload.attemptId !== event.attemptId
  ) {
    throw new Error("Document compilation outbox event failed its dispatch fence");
  }
}

function exponentialDelay(initialMs: number, maximumMs: number, attempt: number): number {
  const exponent = Math.max(0, Math.min(52, attempt - 1));
  return Math.min(maximumMs, initialMs * 2 ** exponent);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 4_096);
  }
  return "Document compilation outbox delivery failed";
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Document compilation outbox ${field} must be a positive integer`);
  }
}

function validTimestamp(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Document compilation outbox ${field} must be a finite timestamp`);
  }
  return value;
}

function isoTimestamp(value: number): string {
  return new Date(value).toISOString();
}
