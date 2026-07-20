import { randomUUID } from "node:crypto";

import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import {
  type LegacySpacePublicationBootstrap,
  type LegacySpacePublicationBootstrapFence,
  type LegacySpacePublicationBootstrapLookupInput,
  type LegacySpacePublicationBootstrapRepository,
  LegacySpacePublicationBootstrapTransitionError,
} from "./legacy-space-publication-bootstrap";

export interface LegacySpacePublicationBootstrapRuntimeOptions {
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly maxBatchSize: number;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly job?: LegacySpacePublicationBootstrap | undefined;
      }) => void)
    | undefined;
  readonly repository: Pick<
    LegacySpacePublicationBootstrapRepository,
    | "beginVerification"
    | "bindAttempt"
    | "captureSnapshot"
    | "claim"
    | "complete"
    | "fail"
    | "getNextItem"
    | "heartbeat"
    | "markItemSucceeded"
    | "release"
  >;
  readonly workerId: string;
}

export interface LegacySpacePublicationBootstrapRuntimeTickResult {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly released: number;
  readonly startedDocuments: number;
  readonly waitingDocuments: number;
}

export interface LegacySpacePublicationBootstrapRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<LegacySpacePublicationBootstrapRuntimeTickResult>;
}

export interface LegacySpacePublicationBootstrapServiceOptions {
  readonly generateId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
  readonly repository: Pick<LegacySpacePublicationBootstrapRepository, "get" | "retry" | "start">;
}

export interface LegacySpacePublicationBootstrapService {
  get(
    input: LegacySpacePublicationBootstrapLookupInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  retry(
    input: LegacySpacePublicationBootstrapLookupInput,
  ): Promise<LegacySpacePublicationBootstrap>;
  start(
    input: LegacySpacePublicationBootstrapLookupInput,
  ): Promise<LegacySpacePublicationBootstrap>;
}

const idempotencyKey = "legacy-space-publication-bootstrap-v1";

/**
 * Coordinates one document generation at a time. Each child compilation may advance an internal
 * head, but strict query readiness remains latched by the bootstrap ledger until `complete`
 * verifies that the final head owns the exact frozen document set.
 */
export function createLegacySpacePublicationBootstrapRuntime({
  compilationJobs,
  generateLeaseToken = randomUUID,
  intervalMs,
  leaseMs,
  maxBatchSize,
  now = Date.now,
  onError,
  repository,
  workerId,
}: LegacySpacePublicationBootstrapRuntimeOptions): LegacySpacePublicationBootstrapRuntime {
  positiveInteger(intervalMs, "intervalMs");
  positiveInteger(leaseMs, "leaseMs");
  positiveInteger(maxBatchSize, "maxBatchSize");
  if (!workerId.trim()) {
    throw new Error("Legacy publication bootstrap runtime workerId must not be empty");
  }

  let activeTick: Promise<LegacySpacePublicationBootstrapRuntimeTickResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<LegacySpacePublicationBootstrapRuntimeTickResult> => {
    if (activeTick) {
      return activeTick;
    }
    activeTick = runTick();
    try {
      return await activeTick;
    } finally {
      activeTick = undefined;
    }
  };

  const runTick = async (): Promise<LegacySpacePublicationBootstrapRuntimeTickResult> => {
    const timestamp = validTimestamp(now());
    const leaseToken = generateLeaseToken();
    const claimed = await repository.claim({
      leaseExpiresAt: iso(timestamp + leaseMs),
      leaseToken,
      limit: maxBatchSize,
      now: iso(timestamp),
      workerId,
    });
    const result: MutableTickResult = {
      claimed: claimed.length,
      completed: 0,
      failed: 0,
      released: 0,
      startedDocuments: 0,
      waitingDocuments: 0,
    };

    for (const job of claimed) {
      let latestJob = job;
      try {
        const outcome = await processClaimedBootstrap({
          compilationJobs,
          job,
          leaseMs,
          now,
          onJobChange: (next) => {
            latestJob = next;
          },
          repository,
          workerId,
        });
        result[outcome] += 1;
      } catch (error) {
        onError?.({ error, job });
        try {
          const failed = await repository.fail({
            errorCode: bootstrapErrorCode(error),
            errorMessage: errorMessage(error),
            expectedRowVersion: latestJob.rowVersion,
            jobId: latestJob.id,
            leaseToken: latestJob.leaseToken ?? leaseToken,
            now: iso(validTimestamp(now())),
          });
          if (failed) {
            result.failed += 1;
          }
        } catch (failureError) {
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
      timer = setInterval(() => {
        void tick().catch((error) => onError?.({ error }));
      }, intervalMs);
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

type TickOutcome = Exclude<keyof MutableTickResult, "claimed" | "failed"> | "failed";

interface MutableTickResult extends LegacySpacePublicationBootstrapRuntimeTickResult {
  claimed: number;
  completed: number;
  failed: number;
  released: number;
  startedDocuments: number;
  waitingDocuments: number;
}

async function processClaimedBootstrap({
  compilationJobs,
  job: initialJob,
  leaseMs,
  now,
  onJobChange,
  repository,
  workerId,
}: {
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly job: LegacySpacePublicationBootstrap;
  readonly leaseMs: number;
  readonly now: () => number;
  readonly onJobChange: (job: LegacySpacePublicationBootstrap) => void;
  readonly repository: LegacySpacePublicationBootstrapRuntimeOptions["repository"];
  readonly workerId: string;
}): Promise<TickOutcome> {
  let job = initialJob;
  const leaseToken = requiredLeaseToken(job);
  const heartbeat = async (): Promise<void> => {
    const timestamp = validTimestamp(now());
    const next = await repository.heartbeat({
      expectedRowVersion: job.rowVersion,
      jobId: job.id,
      leaseExpiresAt: iso(timestamp + leaseMs),
      leaseToken,
      now: iso(timestamp),
      workerId,
    });
    if (!next) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap heartbeat lost its fence",
      );
    }
    job = next;
    onJobChange(job);
  };
  const release = async (): Promise<"released"> => {
    const next = await repository.release(fence(job, leaseToken, now));
    if (!next) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap release lost its fence",
      );
    }
    return "released";
  };

  if (job.checkpoint === "pending_snapshot") {
    const captured = await repository.captureSnapshot(fence(job, leaseToken, now));
    if (!captured) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap snapshot capture lost its fence",
      );
    }
    job = captured;
    onJobChange(job);
    return release();
  }

  const item = await repository.getNextItem(fence(job, leaseToken, now));
  if (!item) {
    const verifying = await repository.beginVerification(fence(job, leaseToken, now));
    if (!verifying) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap verification lost its fence",
      );
    }
    job = verifying;
    onJobChange(job);
    const completed = await repository.complete(fence(job, leaseToken, now));
    if (!completed) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap completion lost its fence",
      );
    }
    return "completed";
  }

  if (item.status === "pending") {
    await heartbeat();
    let compilationJob: DocumentCompilationJob;
    if (item.compilationAttemptId) {
      const current = await compilationJobs.get(item.compilationAttemptId);
      if (!current) {
        throw new Error(
          `Bootstrap compilation attempt ${item.compilationAttemptId} was retained by the ledger but no longer exists`,
        );
      }
      if (current.runState === "failed") {
        if (!compilationJobs.retry) {
          throw new Error("Durable compilation retry is unavailable");
        }
        compilationJob = await compilationJobs.retry(current.id);
      } else {
        compilationJob = current;
      }
    } else {
      compilationJob = await compilationJobs.start({
        bootstrapJobId: job.id,
        ...(compilationJobs.releaseDispatch ? { deferDispatch: true } : {}),
        documentAssetId: item.documentAssetId,
        knowledgeSpaceId: job.knowledgeSpaceId,
        tenantId: job.tenantId,
        version: item.documentVersion,
      });
    }
    await heartbeat();
    const bound = await repository.bindAttempt({
      compilationAttemptId: compilationJob.id,
      documentAssetId: item.documentAssetId,
      ...fence(job, leaseToken, now),
    });
    if (!bound) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap attempt binding lost its fence",
      );
    }
    await compilationJobs.releaseDispatch?.(compilationJob.id);
    job = bound;
    onJobChange(job);
    await release();
    return "startedDocuments";
  }

  if (item.status !== "running" || !item.compilationAttemptId) {
    throw new Error(`Bootstrap item has invalid status=${item.status}`);
  }
  const compilationJob = await compilationJobs.get(item.compilationAttemptId);
  if (!compilationJob) {
    throw new Error(`Bootstrap compilation attempt ${item.compilationAttemptId} was not found`);
  }
  if (compilationJob.runState === "succeeded" && compilationJob.stage === "published") {
    const advanced = await repository.markItemSucceeded({
      compilationAttemptId: compilationJob.id,
      documentAssetId: item.documentAssetId,
      ...fence(job, leaseToken, now),
    });
    if (!advanced) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap item completion lost its fence",
      );
    }
    job = advanced;
    onJobChange(job);
    return release();
  }
  if (
    compilationJob.runState === "failed" ||
    compilationJob.runState === "canceled" ||
    compilationJob.runState === "superseded"
  ) {
    const failed = await repository.fail({
      compilationAttemptId: compilationJob.id,
      documentAssetId: item.documentAssetId,
      errorCode: "DOCUMENT_COMPILATION_FAILED",
      errorMessage: compilationJob.error ?? `Compilation ended as ${compilationJob.runState}`,
      ...fence(job, leaseToken, now),
    });
    if (!failed) {
      throw new LegacySpacePublicationBootstrapTransitionError(
        "Legacy publication bootstrap failure transition lost its fence",
      );
    }
    return "failed";
  }

  await release();
  return "waitingDocuments";
}

export function createLegacySpacePublicationBootstrapService({
  generateId = randomUUID,
  now = () => new Date().toISOString(),
  repository,
}: LegacySpacePublicationBootstrapServiceOptions): LegacySpacePublicationBootstrapService {
  return {
    get: (input) => repository.get(input),
    retry: async (input) => {
      const current = await repository.get(input);
      if (!current) {
        throw new Error("Legacy publication bootstrap not found");
      }
      const retried = await repository.retry({
        expectedRowVersion: current.rowVersion,
        jobId: current.id,
        now: now(),
      });
      if (!retried) {
        throw new LegacySpacePublicationBootstrapTransitionError(
          "Legacy publication bootstrap cannot be retried",
        );
      }
      return retried;
    },
    start: async (input) =>
      (
        await repository.start({
          createdAt: now(),
          id: generateId(),
          idempotencyKey,
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        })
      ).job,
  };
}

function fence(
  job: LegacySpacePublicationBootstrap,
  leaseToken: string,
  now: () => number,
): LegacySpacePublicationBootstrapFence {
  return {
    expectedRowVersion: job.rowVersion,
    jobId: job.id,
    leaseToken,
    now: iso(validTimestamp(now())),
  };
}

function requiredLeaseToken(job: LegacySpacePublicationBootstrap): string {
  if (!job.leaseToken) {
    throw new Error("Claimed legacy publication bootstrap has no lease token");
  }
  return job.leaseToken;
}

function bootstrapErrorCode(error: unknown): string {
  return error instanceof LegacySpacePublicationBootstrapTransitionError
    ? "BOOTSTRAP_FENCE_LOST"
    : "BOOTSTRAP_PROCESSING_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Legacy publication bootstrap failed";
}

function validTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Legacy publication bootstrap runtime now must return a valid timestamp");
  }
  return value;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Legacy publication bootstrap runtime ${name} must be a positive integer`);
  }
}
