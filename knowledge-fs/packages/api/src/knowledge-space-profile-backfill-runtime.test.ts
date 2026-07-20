import { describe, expect, it, vi } from "vitest";

import type {
  KnowledgeSpaceProfileBackfill,
  KnowledgeSpaceProfileBackfillRepository,
} from "./knowledge-space-profile-backfill";
import { createKnowledgeSpaceProfileBackfillRuntime } from "./knowledge-space-profile-backfill-runtime";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";

const NOW_MS = Date.parse("2026-07-14T12:00:00.000Z");
const SOURCE = {
  model: "model",
  pluginId: "plugin",
  provider: "provider",
  revision: 1,
  vectorSpaceId: `embedding-space-sha256:${"c".repeat(64)}`,
};

const RETRIEVAL_SOURCE = {
  defaultMode: "deep" as const,
  reasoningModel: {
    model: "reasoning-model",
    pluginId: "reasoning-plugin",
    provider: "reasoning-provider",
  },
  rerank: {
    enabled: true as const,
    model: {
      model: "rerank-model",
      pluginId: "rerank-plugin",
      provider: "rerank-provider",
    },
  },
  revision: 3,
  scoreThreshold: { enabled: true as const, stage: "mode-final" as const, value: 0.45 },
  topK: 8,
};

function job(runState: "failed" | "running"): KnowledgeSpaceProfileBackfill {
  const running = runState === "running";
  return {
    ...(running ? {} : { completedAt: "2026-07-14T12:00:00.000Z" }),
    createdAt: "2026-07-14T11:59:00.000Z",
    executionAttempts: 1,
    ...(running ? { heartbeatAt: "2026-07-14T12:00:00.000Z" } : {}),
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e41",
    kind: "embedding",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e40",
    ...(running ? {} : { lastErrorCode: "PROFILE_BACKFILL_UNEXPECTED" }),
    ...(running ? {} : { lastErrorMessage: "daemon unavailable" }),
    ...(running ? { leaseExpiresAt: "2026-07-14T12:01:00.000Z" } : {}),
    ...(running ? { leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e42" } : {}),
    maxExecutionAttempts: 3,
    rowVersion: running ? 2 : 3,
    runState,
    sourceManifestVersion: 1,
    sourceSnapshot: SOURCE,
    sourceSnapshotDigest: knowledgeSpaceProfileSnapshotDigest(SOURCE),
    tenantId: "tenant-runtime-test",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...(running ? { workerId: "worker-runtime" } : {}),
  };
}

function retrievalJob(): KnowledgeSpaceProfileBackfill {
  return {
    ...job("running"),
    kind: "retrieval",
    sourceSnapshot: RETRIEVAL_SOURCE,
    sourceSnapshotDigest: knowledgeSpaceProfileSnapshotDigest(RETRIEVAL_SOURCE),
  };
}

describe("knowledge-space profile backfill runtime", () => {
  it("deduplicates concurrent bounded ticks and durably records unexpected processing failure", async () => {
    const running = job("running");
    const failed = job("failed");
    const discover = vi.fn().mockResolvedValue({
      bindingCandidates: [],
      created: 2,
      nextKnowledgeSpaceId: running.knowledgeSpaceId,
      scanned: 3,
    });
    const claim = vi.fn().mockResolvedValue([running]);
    const process = vi.fn().mockRejectedValue(new Error("daemon unavailable"));
    const fail = vi.fn().mockResolvedValue(failed);
    const repository = {
      claim,
      discover,
      fail,
      get: vi.fn(),
      heartbeat: vi.fn(),
      process,
      release: vi.fn(),
      retry: vi.fn(),
    } satisfies KnowledgeSpaceProfileBackfillRepository;
    const runtime = createKnowledgeSpaceProfileBackfillRuntime({
      claimLimit: 4,
      discoveryLimit: 6,
      leaseMs: 60_000,
      now: () => NOW_MS,
      preflight: {
        verify: vi.fn().mockResolvedValue({
          capabilityDigest: `sha256:${"a".repeat(64)}`,
          checkedAt: "2026-07-14T12:00:00.000Z",
          dimension: 768,
          distanceMetric: "cosine",
          kind: "embedding",
          pluginUniqueIdentifier: "installed:plugin",
          schemaFingerprint: `sha256:${"b".repeat(64)}`,
          selection: { model: "model", pluginId: "plugin", provider: "provider" },
        }),
      },
      publicationBindings: { bindCurrentPublished: vi.fn() },
      repository,
      workerId: " worker-runtime ",
    });

    const first = runtime.tick();
    const second = runtime.tick();
    expect(first).toBe(second);
    await expect(first).resolves.toEqual({
      activated: 0,
      bindingFailed: 0,
      bindingsReconciled: 0,
      claimed: 1,
      discovered: 2,
      failed: 1,
      scanned: 3,
    });
    expect(discover).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledWith({
      limit: 6,
      now: "2026-07-14T12:00:00.000Z",
    });
    expect(claim).toHaveBeenCalledWith({
      leaseExpiresAt: "2026-07-14T12:01:00.000Z",
      limit: 4,
      now: "2026-07-14T12:00:00.000Z",
      workerId: "worker-runtime",
    });
    expect(fail).toHaveBeenCalledWith({
      errorCode: "PROFILE_BACKFILL_CAPABILITY_INVALID",
      errorMessage: "Legacy profile capability verification failed",
      expectedRowVersion: 2,
      jobId: running.id,
      leaseToken: running.leaseToken,
      now: "2026-07-14T12:00:00.000Z",
    });
  });

  it("retries missing publication bindings from bounded discovery and deduplicates each space", async () => {
    const scope = {
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e40",
      tenantId: "tenant-runtime-test",
    };
    const bindCurrentPublished = vi.fn().mockResolvedValue({});
    const repository = {
      claim: vi.fn().mockResolvedValue([]),
      discover: vi.fn().mockResolvedValue({
        bindingCandidates: [scope, scope],
        created: 0,
        scanned: 2,
      }),
      fail: vi.fn(),
      get: vi.fn(),
      heartbeat: vi.fn(),
      process: vi.fn(),
      release: vi.fn(),
      retry: vi.fn(),
    } satisfies KnowledgeSpaceProfileBackfillRepository;
    const runtime = createKnowledgeSpaceProfileBackfillRuntime({
      claimLimit: 1,
      discoveryLimit: 2,
      leaseMs: 60_000,
      now: () => NOW_MS,
      preflight: { verify: vi.fn() },
      publicationBindings: { bindCurrentPublished },
      repository,
      workerId: "worker-runtime",
    });

    await expect(runtime.tick()).resolves.toEqual({
      activated: 0,
      bindingFailed: 0,
      bindingsReconciled: 1,
      claimed: 0,
      discovered: 0,
      failed: 0,
      scanned: 2,
    });
    expect(bindCurrentPublished).toHaveBeenCalledOnce();
    expect(bindCurrentPublished).toHaveBeenCalledWith({
      ...scope,
      verifiedAt: "2026-07-14T12:00:00.000Z",
    });
  });

  it("preflights both frozen reasoning and enabled rerank selections before processing retrieval", async () => {
    const running = retrievalJob();
    const reasoningCapability = {
      capabilityDigest: `sha256:${"1".repeat(64)}`,
      checkedAt: "2026-07-14T12:00:00.000Z",
      kind: "reasoning" as const,
      pluginUniqueIdentifier: "installed:reasoning-plugin",
      schemaFingerprint: `sha256:${"2".repeat(64)}`,
      selection: RETRIEVAL_SOURCE.reasoningModel,
    };
    const rerankCapability = {
      capabilityDigest: `sha256:${"3".repeat(64)}`,
      checkedAt: "2026-07-14T12:00:00.000Z",
      kind: "rerank" as const,
      pluginUniqueIdentifier: "installed:rerank-plugin",
      schemaFingerprint: `sha256:${"4".repeat(64)}`,
      selection: RETRIEVAL_SOURCE.rerank.model,
    };
    const verify = vi
      .fn()
      .mockResolvedValueOnce(reasoningCapability)
      .mockResolvedValueOnce(rerankCapability);
    const process = vi.fn().mockResolvedValue({
      activated: true,
      job: { ...running, completedAt: NOW_MS, rowVersion: 3, runState: "succeeded" },
    });
    const repository = {
      claim: vi.fn().mockResolvedValue([running]),
      discover: vi.fn().mockResolvedValue({
        bindingCandidates: [],
        created: 0,
        scanned: 1,
      }),
      fail: vi.fn(),
      get: vi.fn(),
      heartbeat: vi.fn(),
      process,
      release: vi.fn(),
      retry: vi.fn(),
    } satisfies KnowledgeSpaceProfileBackfillRepository;
    const runtime = createKnowledgeSpaceProfileBackfillRuntime({
      claimLimit: 1,
      discoveryLimit: 1,
      leaseMs: 60_000,
      now: () => NOW_MS,
      preflight: { verify },
      publicationBindings: { bindCurrentPublished: vi.fn() },
      repository,
      workerId: "worker-runtime",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ activated: 1, failed: 0 });
    expect(verify).toHaveBeenNthCalledWith(1, {
      kind: "reasoning",
      selection: RETRIEVAL_SOURCE.reasoningModel,
      tenantId: running.tenantId,
    });
    expect(verify).toHaveBeenNthCalledWith(2, {
      kind: "rerank",
      selection: RETRIEVAL_SOURCE.rerank.model,
      tenantId: running.tenantId,
    });
    expect(process).toHaveBeenCalledWith({
      capabilitySnapshot: {
        reasoning: reasoningCapability,
        rerank: rerankCapability,
        verification: "verified",
      },
      expectedRowVersion: running.rowVersion,
      jobId: running.id,
      leaseToken: running.leaseToken,
      now: "2026-07-14T12:00:00.000Z",
    });
  });
});
