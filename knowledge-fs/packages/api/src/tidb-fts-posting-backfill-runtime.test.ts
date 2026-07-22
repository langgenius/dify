import { describe, expect, it, vi } from "vitest";

import type {
  TidbFtsPostingBackfill,
  TidbFtsPostingBackfillRepository,
} from "./tidb-fts-posting-backfill";
import {
  createTidbFtsPostingBackfillRuntime,
  createTidbFtsPostingBackfillService,
} from "./tidb-fts-posting-backfill-runtime";
import { TIDB_FTS_TOKENIZER_VERSION } from "./tidb-fts-postings";

const jobId = "20000000-0000-4000-8000-000000000001";
const spaceId = "10000000-0000-4000-8000-000000000001";
const leaseToken = "40000000-0000-4000-8000-000000000001";

describe("TiDB FTS posting backfill runtime", () => {
  it("discovers, heartbeats, advances bounded projection work, and completes the closure", async () => {
    let current = job();
    let processCalls = 0;
    const repository: Pick<
      TidbFtsPostingBackfillRepository,
      "claim" | "discover" | "fail" | "heartbeat" | "processNext" | "release"
    > = {
      claim: vi.fn(async () => [current]),
      discover: vi.fn(async () => ({ created: 1, scanned: 1 })),
      fail: vi.fn(async () => null),
      heartbeat: vi.fn(async (input) => {
        expect(input.expectedRowVersion).toBe(current.rowVersion);
        current = { ...current, rowVersion: current.rowVersion + 1 };
        return current;
      }),
      processNext: vi.fn(async (input) => {
        expect(input.expectedRowVersion).toBe(current.rowVersion);
        processCalls += 1;
        current = {
          ...current,
          rowVersion: current.rowVersion + 1,
          runState: processCalls === 2 ? "succeeded" : "running",
        };
        return { completed: processCalls === 2, job: current };
      }),
      release: vi.fn(async () => null),
    };
    const ticks = [
      Date.parse("2026-07-14T00:00:00.000Z"),
      Date.parse("2026-07-14T00:00:01.000Z"),
      Date.parse("2026-07-14T00:00:02.000Z"),
      Date.parse("2026-07-14T00:00:03.000Z"),
      Date.parse("2026-07-14T00:00:04.000Z"),
      Date.parse("2026-07-14T00:00:05.000Z"),
    ];
    const runtime = createTidbFtsPostingBackfillRuntime({
      discoveryBatchSize: 5,
      intervalMs: 1_000,
      leaseMs: 30_000,
      maxClaimBatchSize: 2,
      maxProjectionsPerJobPerTick: 2,
      now: () => ticks.shift() ?? Date.parse("2026-07-14T00:00:06.000Z"),
      repository,
      workerId: "worker-1",
    });

    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      discovered: 1,
      failed: 0,
      processed: 1,
      released: 0,
    });
    expect(repository.heartbeat).toHaveBeenCalledTimes(2);
    expect(repository.processNext).toHaveBeenCalledTimes(2);
    expect(repository.release).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("exposes operator get/start/retry without replacing durable repository semantics", async () => {
    const queued = { ...job(), runState: "queued" as const };
    const repository = {
      ensure: vi.fn(async () => queued),
      get: vi.fn(async () => queued),
      retry: vi.fn(async () => queued),
    };
    const service = createTidbFtsPostingBackfillService({
      now: () => "2026-07-14T00:00:00.000Z",
      repository,
    });

    await expect(service.get({ knowledgeSpaceId: spaceId, tenantId: "tenant-1" })).resolves.toBe(
      queued,
    );
    await expect(service.start({ knowledgeSpaceId: spaceId, tenantId: "tenant-1" })).resolves.toBe(
      queued,
    );
    await expect(service.retry({ knowledgeSpaceId: spaceId, tenantId: "tenant-1" })).resolves.toBe(
      queued,
    );
    expect(repository.ensure).toHaveBeenCalledWith({
      knowledgeSpaceId: spaceId,
      now: "2026-07-14T00:00:00.000Z",
      tenantId: "tenant-1",
    });
  });
});

function job(): TidbFtsPostingBackfill {
  return {
    createdAt: "2026-07-14T00:00:00.000Z",
    id: jobId,
    knowledgeSpaceId: spaceId,
    heartbeatAt: "2026-07-14T00:00:00.000Z",
    leaseExpiresAt: "2026-07-14T00:01:00.000Z",
    leaseToken,
    retryCount: 0,
    rowVersion: 1,
    runState: "running",
    scannedProjections: 0,
    tenantId: "tenant-1",
    tokenizerVersion: TIDB_FTS_TOKENIZER_VERSION,
    updatedAt: "2026-07-14T00:00:00.000Z",
    workerId: "worker-1",
    writtenPostings: 0,
  };
}
