import {
  type SourceCredentialBackfillFence,
  type SourceCredentialBackfillJob,
  type SourceCredentialBackfillRepository,
  SourceCredentialBackfillTransitionError,
} from "./source-credential-backfill";
import { readLegacyCredentials } from "./source-credential-service";
import type { SourceRepository } from "./source-repository";
import {
  type SourceSecretStore,
  SourceSecretStoreConflictError,
  SourceSecretStoreIntegrityError,
} from "./source-secret-store";

export interface SourceCredentialBackfillRuntimeOptions {
  readonly discoveryBatchSize: number;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly maxClaimBatchSize: number;
  readonly maxRetryCount: number;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly job?: SourceCredentialBackfillJob | undefined;
      }) => void)
    | undefined;
  readonly repository: Pick<
    SourceCredentialBackfillRepository,
    | "abandonCandidate"
    | "activateCandidate"
    | "claim"
    | "discover"
    | "heartbeat"
    | "refreshCandidate"
    | "retryableFailure"
    | "withWriteAdmission"
  >;
  readonly secretStore: SourceSecretStore;
  readonly sources: Pick<SourceRepository, "get">;
  readonly workerId: string;
}

export interface SourceCredentialBackfillRuntimeResult {
  readonly claimed: number;
  readonly completed: number;
  readonly discovered: number;
  readonly failed: number;
  readonly migrated: number;
  readonly refreshed: number;
  readonly released: number;
  readonly retried: number;
}

export interface SourceCredentialBackfillRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<SourceCredentialBackfillRuntimeResult>;
}

type JobDisposition = "completed" | "migrated" | "refreshed" | "released";

interface MutableRuntimeResult extends SourceCredentialBackfillRuntimeResult {
  claimed: number;
  completed: number;
  discovered: number;
  failed: number;
  migrated: number;
  refreshed: number;
  released: number;
  retried: number;
}

/**
 * Moves exactly one source per claimed job. The candidate reference is durable before the worker
 * writes the encrypted object, so a crash repeats `put` against the same idempotent address.
 * Source attachment, lifecycle activation, and terminal job completion are committed by the
 * repository as one fenced transaction; an `active` claim is therefore recovery-only.
 */
export function createSourceCredentialBackfillRuntime({
  discoveryBatchSize,
  intervalMs,
  leaseMs,
  maxClaimBatchSize,
  maxRetryCount,
  now = Date.now,
  onError,
  repository,
  secretStore,
  sources,
  workerId,
}: SourceCredentialBackfillRuntimeOptions): SourceCredentialBackfillRuntime {
  positiveInteger(discoveryBatchSize, "discoveryBatchSize");
  positiveInteger(intervalMs, "intervalMs");
  positiveInteger(leaseMs, "leaseMs");
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  nonnegativeInteger(maxRetryCount, "maxRetryCount");
  if (!workerId.trim()) {
    throw new Error("Source credential backfill workerId must not be empty");
  }

  let active: Promise<SourceCredentialBackfillRuntimeResult> | undefined;
  let discoveryCursor: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<SourceCredentialBackfillRuntimeResult> => {
    if (active) {
      return active;
    }
    active = runTick();
    try {
      return await active;
    } finally {
      active = undefined;
    }
  };

  const runTick = async (): Promise<SourceCredentialBackfillRuntimeResult> => {
    const result: MutableRuntimeResult = {
      claimed: 0,
      completed: 0,
      discovered: 0,
      failed: 0,
      migrated: 0,
      refreshed: 0,
      released: 0,
      retried: 0,
    };
    try {
      const discovered = await repository.discover({
        ...(discoveryCursor ? { afterSourceId: discoveryCursor } : {}),
        limit: discoveryBatchSize,
        now: iso(validTimestamp(now())),
      });
      result.discovered = discovered.created;
      discoveryCursor =
        discovered.scanned === discoveryBatchSize ? discovered.nextSourceId : undefined;
    } catch (error) {
      onError?.({ error });
    }

    const claimTime = validTimestamp(now());
    const jobs = await repository.claim({
      leaseExpiresAt: iso(claimTime + leaseMs),
      limit: 1,
      now: iso(claimTime),
      workerId,
    });
    result.claimed = jobs.length;

    for (const claimed of jobs) {
      let job = claimed;
      try {
        job = await heartbeat(repository, job, workerId, leaseMs, now);
        const disposition = await processJob({
          job,
          maxRetryCount,
          now,
          repository,
          secretStore,
          sources,
        });
        result[disposition] += 1;
        if (disposition === "migrated") {
          result.completed += 1;
        }
      } catch (error) {
        onError?.({ error, job });
        try {
          const failure = {
            ...fence(job, now),
            errorCode: errorCode(error),
            errorMessage: errorMessage(error),
          };
          if (isTerminalFailure(error) || job.retryCount >= maxRetryCount) {
            await repository.abandonCandidate({
              ...failure,
              terminalState: "failed",
            });
            result.failed += 1;
          } else {
            await repository.retryableFailure(failure);
            result.retried += 1;
          }
        } catch (failureError) {
          // An expired lease may already belong to a replacement worker. The stale worker reports
          // the lost fence but cannot overwrite the replacement lease or its terminal result.
          onError?.({ error: failureError, job });
        }
      }
    }
    return result;
  };

  return {
    start: () => {
      if (timer) {
        return;
      }
      timer = setInterval(() => void tick().catch((error) => onError?.({ error })), intervalMs);
      timer.unref?.();
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

async function processJob(input: {
  readonly job: SourceCredentialBackfillJob;
  readonly maxRetryCount: number;
  readonly now: () => number;
  readonly repository: Pick<
    SourceCredentialBackfillRepository,
    "abandonCandidate" | "activateCandidate" | "refreshCandidate" | "withWriteAdmission"
  >;
  readonly secretStore: SourceSecretStore;
  readonly sources: Pick<SourceRepository, "get">;
}): Promise<JobDisposition> {
  const { job } = input;
  const scope = {
    knowledgeSpaceId: job.knowledgeSpaceId,
    sourceId: job.sourceId,
    tenantId: job.tenantId,
  };
  const source = await input.sources.get({
    id: job.sourceId,
    knowledgeSpaceId: job.knowledgeSpaceId,
  });

  if (job.candidateLifecycleState === "active") {
    if (source?.credentialRef !== job.candidateCredentialRef) {
      throw new SourceCredentialBackfillTransitionError(
        "Active credential candidate is not attached to its source",
      );
    }
    const active = await input.secretStore.get({
      ...scope,
      ref: job.candidateCredentialRef,
    });
    if (!active || active.fingerprint !== job.secretFingerprint) {
      throw new SourceCredentialBackfillTransitionError(
        "Migrated source credential reference is missing or has the wrong fingerprint",
      );
    }
    return transitionDisposition(await input.repository.activateCandidate(fence(job, input.now)));
  }

  if (!source) {
    return transitionDisposition(
      await input.repository.abandonCandidate({
        ...fence(job, input.now),
        terminalState: "succeeded",
      }),
    );
  }

  const legacyCredentials = readLegacyCredentials(source.metadata);
  if (source.credentialRef) {
    if (source.credentialRef === job.candidateCredentialRef) {
      const active = await input.secretStore.get({
        ...scope,
        ref: job.candidateCredentialRef,
      });
      if (!active || active.fingerprint !== job.secretFingerprint) {
        throw new SourceCredentialBackfillTransitionError(
          "Migrated source credential reference is missing or has the wrong fingerprint",
        );
      }
    } else {
      return transitionDisposition(
        await input.repository.abandonCandidate({
          ...fence(job, input.now),
          terminalState: "succeeded",
        }),
      );
    }
    return transitionDisposition(await input.repository.activateCandidate(fence(job, input.now)));
  }

  if (!legacyCredentials) {
    return transitionDisposition(
      await input.repository.abandonCandidate({
        ...fence(job, input.now),
        terminalState: "succeeded",
      }),
    );
  }

  const fingerprint = input.secretStore.fingerprint({ ...scope, credentials: legacyCredentials });
  if (source.version !== job.sourceVersion || fingerprint !== job.secretFingerprint) {
    assertRetryAvailable(job, input.maxRetryCount);
    return transitionDisposition(
      await input.repository.refreshCandidate({
        ...fence(job, input.now),
        secretFingerprint: fingerprint,
        sourceVersion: source.version,
      }),
    );
  }

  if (job.candidateLifecycleState !== "candidate") {
    throw new SourceCredentialBackfillTransitionError(
      "Source credential backfill claim is not backed by a writable candidate lifecycle",
    );
  }

  const stored = await input.repository.withWriteAdmission(
    { knowledgeSpaceId: job.knowledgeSpaceId, tenantId: job.tenantId },
    () =>
      input.secretStore.put({
        ...scope,
        credentials: legacyCredentials,
        ref: job.candidateCredentialRef,
      }),
  );
  if (stored.ref !== job.candidateCredentialRef || stored.fingerprint !== job.secretFingerprint) {
    throw new SourceCredentialBackfillTransitionError(
      "Source SecretStore returned a different candidate reference or fingerprint",
    );
  }

  return transitionDisposition(await input.repository.activateCandidate(fence(job, input.now)));
}

function transitionDisposition(
  result: Awaited<ReturnType<SourceCredentialBackfillRepository["activateCandidate"]>>,
): JobDisposition {
  if (result.outcome === "activated") return "migrated";
  if (result.outcome === "refreshed") return "refreshed";
  return "completed";
}

function assertRetryAvailable(job: SourceCredentialBackfillJob, maxRetryCount: number): void {
  if (job.retryCount >= maxRetryCount) {
    throw new Error("Source credential backfill exhausted its concurrent-change retry budget");
  }
}

async function heartbeat(
  repository: Pick<SourceCredentialBackfillRepository, "heartbeat">,
  job: SourceCredentialBackfillJob,
  workerId: string,
  leaseMs: number,
  now: () => number,
): Promise<SourceCredentialBackfillJob> {
  const timestamp = validTimestamp(now());
  return repository.heartbeat({
    ...fenceAt(job, timestamp),
    leaseExpiresAt: iso(timestamp + leaseMs),
    workerId,
  });
}

function fence(job: SourceCredentialBackfillJob, now: () => number): SourceCredentialBackfillFence {
  return fenceAt(job, validTimestamp(now()));
}

function fenceAt(
  job: SourceCredentialBackfillJob,
  timestamp: number,
): SourceCredentialBackfillFence {
  if (!job.leaseToken) {
    throw new SourceCredentialBackfillTransitionError(
      "Claimed source credential backfill has no lease token",
    );
  }
  return {
    candidateCredentialRef: job.candidateCredentialRef,
    expectedRowVersion: job.rowVersion,
    jobId: job.id,
    leaseToken: job.leaseToken,
    now: iso(timestamp),
  };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code).trim();
    if (/^[A-Z0-9_:-]{1,64}$/u.test(code)) {
      return code.slice(0, 64);
    }
  }
  return error instanceof SourceCredentialBackfillTransitionError
    ? "TRANSITION_CONFLICT"
    : "SOURCE_CREDENTIAL_BACKFILL_FAILED";
}

function errorMessage(error: unknown): string {
  // Never copy arbitrary provider/storage errors into the database: an upstream implementation
  // could include request data in its message. Detailed errors stay in the protected onError lane.
  return error instanceof SourceCredentialBackfillTransitionError
    ? error.message.slice(0, 16_384)
    : "Source credential backfill operation failed";
}

function isTerminalFailure(error: unknown): boolean {
  return (
    error instanceof SourceCredentialBackfillTransitionError ||
    error instanceof SourceSecretStoreConflictError ||
    error instanceof SourceSecretStoreIntegrityError
  );
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Source credential backfill ${name} must be a positive safe integer`);
  }
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Source credential backfill ${name} must be a non-negative safe integer`);
  }
}

function validTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Source credential backfill clock must return a non-negative safe integer");
  }
  return value;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}
