import {
  type TidbFtsPostingBackfill,
  type TidbFtsPostingBackfillFence,
  type TidbFtsPostingBackfillRepository,
  type TidbFtsPostingBackfillScope,
  TidbFtsPostingBackfillTransitionError,
} from "./tidb-fts-posting-backfill";

export interface TidbFtsPostingBackfillRuntimeOptions {
  readonly discoveryBatchSize: number;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly maxClaimBatchSize: number;
  readonly maxProjectionsPerJobPerTick: number;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly job?: TidbFtsPostingBackfill | undefined;
      }) => void)
    | undefined;
  readonly repository: Pick<
    TidbFtsPostingBackfillRepository,
    "claim" | "discover" | "fail" | "heartbeat" | "processNext" | "release"
  >;
  readonly workerId: string;
}

export interface TidbFtsPostingBackfillRuntimeResult {
  readonly claimed: number;
  readonly completed: number;
  readonly discovered: number;
  readonly failed: number;
  readonly processed: number;
  readonly released: number;
}

export interface TidbFtsPostingBackfillRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<TidbFtsPostingBackfillRuntimeResult>;
}

export interface TidbFtsPostingBackfillService {
  get(input: TidbFtsPostingBackfillScope): Promise<TidbFtsPostingBackfill | null>;
  retry(input: TidbFtsPostingBackfillScope): Promise<TidbFtsPostingBackfill>;
  start(input: TidbFtsPostingBackfillScope): Promise<TidbFtsPostingBackfill | null>;
}

interface MutableResult extends TidbFtsPostingBackfillRuntimeResult {
  claimed: number;
  completed: number;
  discovered: number;
  failed: number;
  processed: number;
  released: number;
}

/** Runs bounded, restart-safe discovery and projection repair outside the migration runner. */
export function createTidbFtsPostingBackfillRuntime({
  discoveryBatchSize,
  intervalMs,
  leaseMs,
  maxClaimBatchSize,
  maxProjectionsPerJobPerTick,
  now = Date.now,
  onError,
  repository,
  workerId,
}: TidbFtsPostingBackfillRuntimeOptions): TidbFtsPostingBackfillRuntime {
  positiveInteger(discoveryBatchSize, "discoveryBatchSize");
  positiveInteger(intervalMs, "intervalMs");
  positiveInteger(leaseMs, "leaseMs");
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxProjectionsPerJobPerTick, "maxProjectionsPerJobPerTick");
  if (!workerId.trim()) {
    throw new Error("TiDB FTS backfill workerId must not be empty");
  }

  let active: Promise<TidbFtsPostingBackfillRuntimeResult> | undefined;
  let discoveryCursor: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<TidbFtsPostingBackfillRuntimeResult> => {
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

  const runTick = async (): Promise<TidbFtsPostingBackfillRuntimeResult> => {
    const result: MutableResult = {
      claimed: 0,
      completed: 0,
      discovered: 0,
      failed: 0,
      processed: 0,
      released: 0,
    };
    const discoveryTime = validTimestamp(now());
    try {
      const discovery = await repository.discover({
        ...(discoveryCursor ? { afterKnowledgeSpaceId: discoveryCursor } : {}),
        limit: discoveryBatchSize,
        now: iso(discoveryTime),
      });
      result.discovered = discovery.created;
      discoveryCursor =
        discovery.scanned === discoveryBatchSize ? discovery.nextKnowledgeSpaceId : undefined;
    } catch (error) {
      onError?.({ error });
    }

    const claimTime = validTimestamp(now());
    const jobs = await repository.claim({
      leaseExpiresAt: iso(claimTime + leaseMs),
      limit: maxClaimBatchSize,
      now: iso(claimTime),
      workerId,
    });
    result.claimed = jobs.length;

    for (const claimed of jobs) {
      let job = claimed;
      const leaseToken = requiredLeaseToken(claimed);
      let finished = false;
      try {
        for (let index = 0; index < maxProjectionsPerJobPerTick; index += 1) {
          job = await heartbeat(repository, job, leaseToken, workerId, leaseMs, now);
          const processed = await repository.processNext(fence(job, leaseToken, now));
          job = processed.job;
          if (processed.completed) {
            result.completed += 1;
            finished = true;
            break;
          }
          result.processed += 1;
        }

        if (!finished) {
          const released = await repository.release(fence(job, leaseToken, now));
          if (!released) {
            throw new TidbFtsPostingBackfillTransitionError(
              "TiDB FTS backfill release lost its worker fence",
            );
          }
          result.released += 1;
        }
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
          // A replacement worker may already own an expired lease. A stale worker reports the
          // lost fence but never mutates the replacement lease.
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

export function createTidbFtsPostingBackfillService(input: {
  readonly now?: (() => string) | undefined;
  readonly repository: Pick<TidbFtsPostingBackfillRepository, "ensure" | "get" | "retry">;
}): TidbFtsPostingBackfillService {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    get: (scope) => input.repository.get(scope),
    retry: async (scope) => {
      const retried = await input.repository.retry({ ...scope, now: now() });
      if (!retried) {
        throw new TidbFtsPostingBackfillTransitionError("TiDB FTS posting backfill was not found");
      }
      return retried;
    },
    start: (scope) => input.repository.ensure({ ...scope, now: now() }),
  };
}

async function heartbeat(
  repository: Pick<TidbFtsPostingBackfillRepository, "heartbeat">,
  job: TidbFtsPostingBackfill,
  leaseToken: string,
  workerId: string,
  leaseMs: number,
  now: () => number,
): Promise<TidbFtsPostingBackfill> {
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
    throw new TidbFtsPostingBackfillTransitionError(
      "TiDB FTS backfill heartbeat lost its worker fence",
    );
  }
  return next;
}

function fence(
  job: TidbFtsPostingBackfill,
  leaseToken: string,
  now: () => number,
): TidbFtsPostingBackfillFence {
  return {
    expectedRowVersion: job.rowVersion,
    jobId: job.id,
    leaseToken,
    now: iso(validTimestamp(now())),
  };
}

function requiredLeaseToken(job: TidbFtsPostingBackfill): string {
  if (!job.leaseToken) {
    throw new TidbFtsPostingBackfillTransitionError("Claimed TiDB FTS backfill has no lease token");
  }
  return job.leaseToken;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code).trim();
    if (code) {
      return code.slice(0, 64);
    }
  }
  return error instanceof TidbFtsPostingBackfillTransitionError
    ? "TRANSITION_CONFLICT"
    : "BACKFILL_FAILED";
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 16_384);
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`TiDB FTS backfill ${name} must be a positive safe integer`);
  }
}

function validTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("TiDB FTS backfill clock must return a non-negative safe integer");
  }
  return value;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}
