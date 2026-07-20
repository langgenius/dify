import type {
  SourceSecretDeleteFence,
  SourceSecretLifecycleRef,
  SourceSecretLifecycleRepository,
} from "./source-retired-secret-cleanup";
import type { SourceSecretStore } from "./source-secret-store";

export interface SourceRetiredSecretCleanupRuntimeOptions {
  readonly heartbeatIntervalMs?: number | undefined;
  readonly intervalMs: number;
  readonly leaseMs: number;
  /**
   * Kept for configuration compatibility. The lifecycle repository intentionally claims exactly
   * one reference per tick, regardless of this historical batch setting.
   */
  readonly maxClaimBatchSize: number;
  /** Caps the exponential-backoff exponent; deletion itself remains retryable until it succeeds. */
  readonly maxRetryCount: number;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly job?: SourceSecretLifecycleRef | undefined;
      }) => void)
    | undefined;
  readonly repository: Pick<
    SourceSecretLifecycleRepository,
    "beginDelete" | "completeDelete" | "reconcileExpiredStaged" | "renewDelete" | "retryDelete"
  >;
  readonly secretStore: SourceSecretStore;
  readonly workerId: string;
}

export interface SourceRetiredSecretCleanupRuntimeResult {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
}

export interface SourceRetiredSecretCleanupRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<SourceRetiredSecretCleanupRuntimeResult>;
}

const MAX_RETRY_BACKOFF_MS = 24 * 60 * 60 * 1_000;
const DELETE_ERROR_CODE = "SOURCE_SECRET_DELETE_FAILED";
const DELETE_ERROR_MESSAGE = "Source secret deletion failed";

/**
 * Reconciles one abandoned staged write and deletes at most one lifecycle-fenced reference.
 *
 * The synchronous renewal immediately before SecretStore.delete is the destructive-operation
 * admission fence. Periodic renewals only keep that already-admitted operation alive. If any
 * renewal becomes ambiguous or stale, the runtime performs no later state transition; an expired
 * lease lets another process replay the idempotent delete instead.
 */
export function createSourceRetiredSecretCleanupRuntime({
  heartbeatIntervalMs,
  intervalMs,
  leaseMs,
  maxClaimBatchSize,
  maxRetryCount,
  now = Date.now,
  onError,
  repository,
  secretStore,
  workerId,
}: SourceRetiredSecretCleanupRuntimeOptions): SourceRetiredSecretCleanupRuntime {
  positiveInteger(intervalMs, "intervalMs");
  positiveInteger(leaseMs, "leaseMs");
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  nonnegativeInteger(maxRetryCount, "maxRetryCount");
  const effectiveHeartbeatIntervalMs = heartbeatIntervalMs ?? Math.max(1, Math.floor(leaseMs / 3));
  positiveInteger(effectiveHeartbeatIntervalMs, "heartbeatIntervalMs");
  if (effectiveHeartbeatIntervalMs >= leaseMs) {
    throw new Error("Source retired-secret cleanup heartbeatIntervalMs must be less than leaseMs");
  }
  if (!workerId.trim()) {
    throw new Error("Source retired-secret cleanup workerId must not be empty");
  }

  let active: Promise<SourceRetiredSecretCleanupRuntimeResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<SourceRetiredSecretCleanupRuntimeResult> => {
    if (active) {
      return active;
    }

    active = (async () => {
      const reconcileTime = validTimestamp(now());
      await repository.reconcileExpiredStaged({
        nextRecoverAfter: iso(addTimestamp(reconcileTime, intervalMs)),
        now: iso(reconcileTime),
      });

      const claimTime = validTimestamp(now());
      const claimed = await repository.beginDelete({
        leaseExpiresAt: iso(addTimestamp(claimTime, leaseMs)),
        now: iso(claimTime),
        workerId,
      });
      const result = { claimed: claimed ? 1 : 0, completed: 0, failed: 0, retried: 0 };

      if (!claimed) {
        return result;
      }

      let current = claimed;
      let lane: Promise<void> = Promise.resolve();
      let renewalFailed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
        const run = lane.then(operation);
        lane = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      };
      const renew = async (): Promise<void> => {
        const timestamp = validTimestamp(now());
        current = await serialize(() =>
          repository.renewDelete({
            ...deleteFenceAt(current, timestamp),
            leaseExpiresAt: iso(addTimestamp(timestamp, leaseMs)),
            workerId,
          }),
        );
      };
      const stopHeartbeats = async (): Promise<void> => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        await lane;
      };

      // A claim is not sufficient admission for an external side effect. Renew synchronously so
      // an expired/replaced worker cannot reach SecretStore.delete with a stale row version.
      try {
        await renew();
      } catch (error) {
        onError?.({ error, job: current });
        result.failed += 1;
        return result;
      }

      heartbeatTimer = setInterval(() => {
        void renew().catch((error) => {
          renewalFailed = true;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          onError?.({ error, job: current });
        });
      }, effectiveHeartbeatIntervalMs);
      heartbeatTimer.unref?.();

      let deleteError: unknown;
      let deleteFailed = false;
      try {
        await secretStore.delete({
          knowledgeSpaceId: current.knowledgeSpaceId,
          ref: current.credentialRef,
          sourceId: current.sourceId,
          tenantId: current.tenantId,
        });
      } catch (error) {
        deleteError = error;
        deleteFailed = true;
      } finally {
        await stopHeartbeats();
      }

      if (renewalFailed) {
        // The external call may already have succeeded. Do not use an ambiguous/stale fence for a
        // completion or retry transition; lease expiry makes the missing-object delete replayable.
        result.failed += 1;
        return result;
      }

      if (deleteFailed) {
        onError?.({ error: deleteError, job: current });
        try {
          const failureTime = validTimestamp(now());
          current = await repository.retryDelete({
            ...deleteFenceAt(current, failureTime),
            errorCode: DELETE_ERROR_CODE,
            errorMessage: DELETE_ERROR_MESSAGE,
            nextDeleteAt: iso(
              addTimestamp(
                failureTime,
                retryBackoffMs(intervalMs, current.deleteAttempts, maxRetryCount),
              ),
            ),
          });
          result.retried += 1;
        } catch (transitionError) {
          onError?.({ error: transitionError, job: current });
          result.failed += 1;
        }
        return result;
      }

      try {
        const completionTime = validTimestamp(now());
        current = await repository.completeDelete({
          ...deleteFenceAt(current, completionTime),
          nextDeleteAt: iso(addTimestamp(completionTime, intervalMs)),
        });
        result.completed += 1;
      } catch (error) {
        // Deletion already happened. Leaving the row deleting is deliberate: after lease expiry a
        // replacement worker repeats the idempotent missing-object delete and completes the row.
        onError?.({ error, job: current });
        result.failed += 1;
      }

      return result;
    })().finally(() => {
      active = undefined;
    });
    return active;
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

function deleteFenceAt(
  reference: SourceSecretLifecycleRef,
  timestamp: number,
): SourceSecretDeleteFence {
  if (!reference.leaseToken) {
    throw new Error("Deleting source secret lifecycle ref has no lease token");
  }
  return {
    credentialRef: reference.credentialRef,
    expectedRowVersion: reference.rowVersion,
    leaseToken: reference.leaseToken,
    now: iso(timestamp),
  };
}

function retryBackoffMs(intervalMs: number, deleteAttempts: number, maxExponent: number): number {
  nonnegativeInteger(deleteAttempts, "deleteAttempts");
  const exponent = Math.min(deleteAttempts, maxExponent);
  const cap = Math.max(intervalMs, MAX_RETRY_BACKOFF_MS);
  let delay = intervalMs;

  for (let index = 0; index < exponent; index += 1) {
    if (delay >= cap / 2) {
      return cap;
    }
    delay *= 2;
  }

  return Math.min(delay, cap);
}

function addTimestamp(timestamp: number, milliseconds: number): number {
  const result = timestamp + milliseconds;
  if (!Number.isSafeInteger(result) || result < 0 || !Number.isFinite(new Date(result).getTime())) {
    throw new Error("Source retired-secret cleanup timestamp exceeds the supported date range");
  }
  return result;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function validTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new Error("Source retired-secret cleanup clock must return a supported nonnegative date");
  }
  return value;
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Source retired-secret cleanup ${field} must be a positive integer`);
  }
}

function nonnegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Source retired-secret cleanup ${field} must be nonnegative`);
  }
}
