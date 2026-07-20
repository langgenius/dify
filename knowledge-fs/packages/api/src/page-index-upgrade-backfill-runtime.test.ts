import type { DocumentOutline } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  PageIndexUpgradeBackfill,
  PageIndexUpgradeBackfillRepository,
} from "./page-index-upgrade-backfill";
import {
  createPageIndexUpgradeBackfillRuntime,
  createPageIndexUpgradeBackfillService,
} from "./page-index-upgrade-backfill-runtime";

const jobId = "60000000-0000-4000-8000-000000000001";
const outlineId = "30000000-0000-4000-8000-000000000001";
const leaseToken = "70000000-0000-4000-8000-000000000001";

describe("PageIndex upgrade backfill runtime", () => {
  it("durably advances one frozen item only after exact materialization", async () => {
    let job = runningJob();
    const repository = runtimeRepository({
      getNextItem: async () => ({ item: frozenItem(), outline: outline() }),
      heartbeat: async () => {
        job = { ...job, rowVersion: job.rowVersion + 1 };
        return job;
      },
      markItemSucceeded: async () => {
        job = { ...job, completedItems: 1, rowVersion: job.rowVersion + 1 };
        return job;
      },
      release: async () => {
        job = { ...job, runState: "queued", rowVersion: job.rowVersion + 1 };
        return job;
      },
    });
    const materializeBuilding = vi.fn(async () => ({ status: "building" as const }));
    const hasCompleteBuild = vi.fn(async () => true);
    const runtime = createPageIndexUpgradeBackfillRuntime({
      builds: { hasCompleteBuild, materializeBuilding: materializeBuilding as never },
      intervalMs: 1_000,
      leaseMs: 60_000,
      maxBatchSize: 1,
      now: () => Date.parse("2026-07-14T00:00:00.000Z"),
      repository,
      workerId: "worker-1",
    });

    await expect(runtime.tick()).resolves.toEqual({
      built: 1,
      claimed: 1,
      completed: 0,
      failed: 0,
      released: 1,
      superseded: 0,
    });
    expect(materializeBuilding).toHaveBeenCalledWith({
      builtAt: "2026-07-14T00:00:00.000Z",
      outline: outline(),
      tenantId: "tenant-1",
    });
    expect(hasCompleteBuild).toHaveBeenCalledOnce();
  });

  it("reports a head change as superseded and never promotes an old conclusion", async () => {
    let job = runningJob({ completedItems: 1 });
    const repository = runtimeRepository({
      complete: async () => ({ ...job, runState: "superseded" }),
      getNextItem: async () => null,
      heartbeat: async () => {
        job = { ...job, rowVersion: job.rowVersion + 1 };
        return job;
      },
    });
    const runtime = createPageIndexUpgradeBackfillRuntime({
      builds: {
        hasCompleteBuild: vi.fn(),
        materializeBuilding: vi.fn(),
      },
      intervalMs: 1_000,
      leaseMs: 60_000,
      maxBatchSize: 1,
      now: () => Date.parse("2026-07-14T00:00:00.000Z"),
      repository,
      workerId: "worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ completed: 0, superseded: 1 });
  });

  it("fails a fenced job after a crash and lets the operator retry the durable ledger", async () => {
    let job = runningJob();
    const fail = vi.fn(async () => ({ ...job, runState: "failed" as const }));
    const repository = runtimeRepository({
      fail,
      getNextItem: async () => ({ item: frozenItem(), outline: outline() }),
      heartbeat: async () => {
        job = { ...job, rowVersion: job.rowVersion + 1 };
        return job;
      },
    });
    const runtime = createPageIndexUpgradeBackfillRuntime({
      builds: {
        hasCompleteBuild: vi.fn(),
        materializeBuilding: async () => {
          throw new Error("worker crashed");
        },
      },
      intervalMs: 1_000,
      leaseMs: 60_000,
      maxBatchSize: 1,
      now: () => Date.parse("2026-07-14T00:00:00.000Z"),
      repository,
      workerId: "worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: "worker crashed", leaseToken }),
    );

    const retry = vi.fn(async () => ({ ...job, runState: "queued" as const }));
    const service = createPageIndexUpgradeBackfillService({
      now: () => "2026-07-14T00:01:00.000Z",
      repository: { ensureCurrentHead: vi.fn(), get: vi.fn(), retry },
    });
    await expect(
      service.retry({ knowledgeSpaceId: job.knowledgeSpaceId, tenantId: job.tenantId }),
    ).resolves.toMatchObject({ runState: "queued" });
    expect(retry).toHaveBeenCalledWith({
      knowledgeSpaceId: job.knowledgeSpaceId,
      now: "2026-07-14T00:01:00.000Z",
      tenantId: job.tenantId,
    });
  });
});

function runtimeRepository(
  overrides: Partial<PageIndexUpgradeBackfillRepository>,
): PageIndexUpgradeBackfillRepository {
  return {
    claim: async () => [runningJob()],
    complete: async () => runningJob({ runState: "succeeded" }),
    ensureCurrentHead: async () => null,
    fail: async () => runningJob({ runState: "failed" }),
    get: async () => null,
    getNextItem: async () => null,
    heartbeat: async () => runningJob({ rowVersion: 2 }),
    isQueryReady: async () => true,
    markItemSucceeded: async () => runningJob({ completedItems: 1, rowVersion: 3 }),
    release: async () => runningJob({ rowVersion: 4, runState: "queued" }),
    retry: async () => runningJob({ runState: "queued" }),
    ...overrides,
  };
}

function runningJob(overrides: Partial<PageIndexUpgradeBackfill> = {}): PageIndexUpgradeBackfill {
  return {
    completedItems: 0,
    createdAt: "2026-07-14T00:00:00.000Z",
    headRevision: 3,
    heartbeatAt: "2026-07-14T00:00:00.000Z",
    id: jobId,
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    leaseExpiresAt: "2026-07-14T00:01:00.000Z",
    leaseToken,
    publicationFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    publicationId: jobId,
    retryCount: 0,
    rowVersion: 1,
    runState: "running",
    tenantId: "tenant-1",
    totalItems: 1,
    updatedAt: "2026-07-14T00:00:00.000Z",
    workerId: "worker-1",
    ...overrides,
  };
}

function frozenItem() {
  return {
    backfillId: jobId,
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId: "20000000-0000-4000-8000-000000000001",
    documentOutlineId: outlineId,
    documentVersion: 1,
    ordinal: 0,
    publicationGenerationId: "50000000-0000-4000-8000-000000000001",
    status: "pending" as const,
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function outline(): DocumentOutline {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId: "20000000-0000-4000-8000-000000000001",
    id: outlineId,
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        endOffset: 10,
        id: "section-1",
        level: 1,
        metadata: {},
        sectionPath: ["Camera"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Sensor details",
        title: "Camera",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    publicationGenerationId: "50000000-0000-4000-8000-000000000001",
    version: 1,
  };
}
