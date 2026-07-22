import {
  type LegacySpacePublicationBootstrapRepository,
  withKnowledgeSpaceDocumentMutationLease,
} from "./legacy-space-publication-bootstrap";
import type { PublishedPageIndexBuildRepository } from "./page-index-build-repository";
import {
  type PageIndexUpgradeBackfill,
  type PageIndexUpgradeBackfillLookupInput,
  type PageIndexUpgradeBackfillRepository,
  PageIndexUpgradeBackfillTransitionError,
} from "./page-index-upgrade-backfill";

export interface PageIndexUpgradeBackfillRuntimeOptions {
  readonly builds: Pick<
    PublishedPageIndexBuildRepository,
    "hasCompleteBuild" | "materializeBuilding"
  >;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly maxBatchSize: number;
  readonly mutationLeases?:
    | Pick<
        LegacySpacePublicationBootstrapRepository,
        | "acquireDocumentMutationLease"
        | "heartbeatDocumentMutationLease"
        | "releaseDocumentMutationLease"
      >
    | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly job?: PageIndexUpgradeBackfill | undefined;
      }) => void)
    | undefined;
  readonly repository: Pick<
    PageIndexUpgradeBackfillRepository,
    "claim" | "complete" | "fail" | "getNextItem" | "heartbeat" | "markItemSucceeded" | "release"
  >;
  readonly workerId: string;
}

export interface PageIndexUpgradeBackfillRuntimeResult {
  readonly built: number;
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly released: number;
  readonly superseded: number;
}

export interface PageIndexUpgradeBackfillRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<PageIndexUpgradeBackfillRuntimeResult>;
}

interface MutableResult extends PageIndexUpgradeBackfillRuntimeResult {
  built: number;
  claimed: number;
  completed: number;
  failed: number;
  released: number;
  superseded: number;
}

export interface PageIndexUpgradeBackfillService {
  get(input: PageIndexUpgradeBackfillLookupInput): Promise<PageIndexUpgradeBackfill | null>;
  retry(input: PageIndexUpgradeBackfillLookupInput): Promise<PageIndexUpgradeBackfill>;
  start(input: PageIndexUpgradeBackfillLookupInput): Promise<PageIndexUpgradeBackfill | null>;
}

/**
 * Runs one frozen outline per claimed job per tick. This keeps work bounded and persists the item
 * cursor only after create-once PageIndex materialization has been revalidated. A crash between
 * materialization and the ledger update safely replays the exact immutable generation.
 */
export function createPageIndexUpgradeBackfillRuntime({
  builds,
  intervalMs,
  leaseMs,
  maxBatchSize,
  mutationLeases,
  now = Date.now,
  onError,
  repository,
  workerId,
}: PageIndexUpgradeBackfillRuntimeOptions): PageIndexUpgradeBackfillRuntime {
  positiveInteger(intervalMs, "intervalMs");
  positiveInteger(leaseMs, "leaseMs");
  positiveInteger(maxBatchSize, "maxBatchSize");
  if (!workerId.trim()) {
    throw new Error("PageIndex upgrade workerId must not be empty");
  }

  let active: Promise<PageIndexUpgradeBackfillRuntimeResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<PageIndexUpgradeBackfillRuntimeResult> => {
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

  const runTick = async (): Promise<PageIndexUpgradeBackfillRuntimeResult> => {
    const timestamp = validTimestamp(now());
    const jobs = await repository.claim({
      leaseExpiresAt: iso(timestamp + leaseMs),
      limit: maxBatchSize,
      now: iso(timestamp),
      workerId,
    });
    const result: MutableResult = {
      built: 0,
      claimed: jobs.length,
      completed: 0,
      failed: 0,
      released: 0,
      superseded: 0,
    };

    for (const claimed of jobs) {
      let job = claimed;
      const leaseToken = requiredLeaseToken(claimed);
      try {
        const heartbeat = async (): Promise<void> => {
          const heartbeatAt = validTimestamp(now());
          const next = await repository.heartbeat({
            expectedRowVersion: job.rowVersion,
            jobId: job.id,
            leaseExpiresAt: iso(heartbeatAt + leaseMs),
            leaseToken,
            now: iso(heartbeatAt),
            workerId,
          });
          if (!next) {
            throw new PageIndexUpgradeBackfillTransitionError(
              "PageIndex upgrade heartbeat lost its worker fence",
            );
          }
          job = next;
        };

        await heartbeat();
        const item = await repository.getNextItem(fence(job, leaseToken, now));
        if (!item) {
          const completed = await repository.complete(fence(job, leaseToken, now));
          if (!completed) {
            throw new PageIndexUpgradeBackfillTransitionError(
              "PageIndex upgrade completion lost its worker fence",
            );
          }
          result[completed.runState === "superseded" ? "superseded" : "completed"] += 1;
          continue;
        }

        await withKnowledgeSpaceDocumentMutationLease({
          acquiredAt: iso(validTimestamp(now())),
          knowledgeSpaceId: job.knowledgeSpaceId,
          mutate: async () => {
            await builds.materializeBuilding({
              builtAt: iso(validTimestamp(now())),
              outline: item.outline,
              tenantId: job.tenantId,
            });
            if (
              !(await builds.hasCompleteBuild({ outline: item.outline, tenantId: job.tenantId }))
            ) {
              throw new Error("PageIndex materialization did not persist its exact child closure");
            }
            await heartbeat();
            const marked = await repository.markItemSucceeded({
              ...fence(job, leaseToken, now),
              documentOutlineId: item.item.documentOutlineId,
            });
            if (!marked) {
              throw new PageIndexUpgradeBackfillTransitionError(
                "PageIndex upgrade item completion lost its worker fence",
              );
            }
            job = marked;
          },
          operation: "page-index-upgrade",
          repository: mutationLeases,
          tenantId: job.tenantId,
        });
        result.built += 1;
        const released = await repository.release(fence(job, leaseToken, now));
        if (!released) {
          throw new PageIndexUpgradeBackfillTransitionError(
            "PageIndex upgrade release lost its worker fence",
          );
        }
        result.released += 1;
      } catch (error) {
        onError?.({ error, job });
        try {
          const failed = await repository.fail({
            ...fence(job, leaseToken, now),
            errorCode: errorCode(error),
            errorMessage: errorMessage(error),
          });
          if (failed) {
            result.failed += 1;
          }
        } catch (failureError) {
          // A second worker may have recovered an expired lease. The stale worker must not mutate
          // the replacement lease and only reports the lost fence.
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

export function createPageIndexUpgradeBackfillService(input: {
  readonly now?: (() => string) | undefined;
  readonly repository: Pick<
    PageIndexUpgradeBackfillRepository,
    "ensureCurrentHead" | "get" | "retry"
  >;
}): PageIndexUpgradeBackfillService {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    get: (scope) => input.repository.get(scope),
    retry: async (scope) => {
      const retried = await input.repository.retry({ ...scope, now: now() });
      if (!retried) {
        throw new PageIndexUpgradeBackfillTransitionError(
          "PageIndex upgrade backfill was not found or is not required",
        );
      }
      return retried;
    },
    start: (scope) => input.repository.ensureCurrentHead({ ...scope, now: now() }),
  };
}

function fence(job: PageIndexUpgradeBackfill, leaseToken: string, now: () => number) {
  return {
    expectedRowVersion: job.rowVersion,
    jobId: job.id,
    leaseToken,
    now: iso(validTimestamp(now())),
  };
}

function requiredLeaseToken(job: PageIndexUpgradeBackfill): string {
  if (!job.leaseToken) {
    throw new PageIndexUpgradeBackfillTransitionError(
      "Claimed PageIndex upgrade has no lease token",
    );
  }
  return job.leaseToken;
}

function errorCode(error: unknown): string {
  if (error instanceof PageIndexUpgradeBackfillTransitionError) {
    return "TRANSITION_CONFLICT";
  }
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64) || "BACKFILL_FAILED";
  }
  return "BACKFILL_FAILED";
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 16_384);
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function validTimestamp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("PageIndex upgrade clock must return a finite timestamp");
  }
  return value;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex upgrade runtime ${name} must be at least 1`);
  }
}
