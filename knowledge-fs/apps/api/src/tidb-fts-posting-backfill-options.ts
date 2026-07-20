import { randomUUID } from "node:crypto";

import {
  type TidbFtsPostingBackfillRepository,
  type TidbFtsPostingBackfillRuntime,
  type TidbFtsPostingBackfillService,
  createTidbFtsPostingBackfillRuntime,
  createTidbFtsPostingBackfillService,
} from "@knowledge/api";

export interface ApiTidbFtsPostingBackfillEnv {
  readonly KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH?: string | undefined;
  readonly KNOWLEDGE_TIDB_FTS_BACKFILL_DISCOVERY_BATCH?: string | undefined;
  readonly KNOWLEDGE_TIDB_FTS_BACKFILL_INTERVAL_MS?: string | undefined;
  readonly KNOWLEDGE_TIDB_FTS_BACKFILL_LEASE_MS?: string | undefined;
  readonly KNOWLEDGE_TIDB_FTS_BACKFILL_PROJECTIONS_PER_TICK?: string | undefined;
}

export interface ApiTidbFtsPostingBackfillAssembly {
  readonly runtime: TidbFtsPostingBackfillRuntime;
  readonly service: TidbFtsPostingBackfillService;
  start(): void;
  stop(): void;
}

/**
 * Starts on every TiDB API replica. Durable leases make that safe and ensure old spaces continue
 * converging even when document compilation workers are intentionally disabled on the replica.
 */
export function createApiTidbFtsPostingBackfillAssembly(input: {
  readonly env?: ApiTidbFtsPostingBackfillEnv | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly jobId?: string | undefined }) => void)
    | undefined;
  readonly repository?: TidbFtsPostingBackfillRepository | undefined;
}): ApiTidbFtsPostingBackfillAssembly | undefined {
  if (!input.repository) {
    return undefined;
  }
  const env = input.env ?? process.env;
  const workerId = `tidb-fts-posting-backfill-${process.pid}-${randomUUID()}`;
  const runtime = createTidbFtsPostingBackfillRuntime({
    discoveryBatchSize: positiveEnv(
      env.KNOWLEDGE_TIDB_FTS_BACKFILL_DISCOVERY_BATCH,
      100,
      "KNOWLEDGE_TIDB_FTS_BACKFILL_DISCOVERY_BATCH",
    ),
    intervalMs: positiveEnv(
      env.KNOWLEDGE_TIDB_FTS_BACKFILL_INTERVAL_MS,
      1_000,
      "KNOWLEDGE_TIDB_FTS_BACKFILL_INTERVAL_MS",
    ),
    leaseMs: positiveEnv(
      env.KNOWLEDGE_TIDB_FTS_BACKFILL_LEASE_MS,
      30_000,
      "KNOWLEDGE_TIDB_FTS_BACKFILL_LEASE_MS",
    ),
    maxClaimBatchSize: positiveEnv(
      env.KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH,
      10,
      "KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH",
    ),
    maxProjectionsPerJobPerTick: positiveEnv(
      env.KNOWLEDGE_TIDB_FTS_BACKFILL_PROJECTIONS_PER_TICK,
      10,
      "KNOWLEDGE_TIDB_FTS_BACKFILL_PROJECTIONS_PER_TICK",
    ),
    onError: ({ error, job }) => input.onError?.({ error, ...(job ? { jobId: job.id } : {}) }),
    repository: input.repository,
    workerId,
  });
  const service = createTidbFtsPostingBackfillService({ repository: input.repository });
  let started = false;
  return {
    runtime,
    service,
    start: () => {
      if (started) {
        return;
      }
      started = true;
      runtime.start();
    },
    stop: () => {
      if (!started) {
        return;
      }
      runtime.stop();
      started = false;
    },
  };
}

function positiveEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}
