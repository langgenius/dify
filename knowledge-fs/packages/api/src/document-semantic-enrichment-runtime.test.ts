import { describe, expect, it, vi } from "vitest";

import { createInMemoryDocumentSemanticEnrichmentRepository } from "./document-semantic-enrichment-repository";
import { createDocumentSemanticEnrichmentRuntime } from "./document-semantic-enrichment-runtime";

const startedAt = Date.parse("2026-08-09T10:00:00.000Z");

describe("createDocumentSemanticEnrichmentRuntime", () => {
  it("waits for publication without consuming model execution attempts", async () => {
    let now = startedAt;
    let generationStatus: "pending" | "superseded" = "pending";
    const repository = createInMemoryDocumentSemanticEnrichmentRepository({
      generateLeaseToken: sequence([uuid(20), uuid(21)]),
    });
    const job = await repository.enqueue(jobInput(uuid(10), 2));
    const processor = { process: vi.fn() };
    const runtime = createDocumentSemanticEnrichmentRuntime({
      claimLimit: 1,
      generationGuard: { status: async () => generationStatus },
      heartbeatIntervalMs: 50,
      intervalMs: 1_000,
      leaseMs: 100,
      now: () => now,
      processor,
      repository,
      retryBaseMs: 1_000,
      workerId: "semantic-worker",
    });

    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      failed: 0,
      retried: 1,
      succeeded: 0,
      superseded: 0,
    });
    expect(processor.process).not.toHaveBeenCalled();

    await expect(repository.get(job.id)).resolves.toMatchObject({
      executionAttempts: 0,
      runState: "retry_wait",
    });

    now += 1_000;
    generationStatus = "superseded";
    await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, superseded: 1 });
    await expect(repository.get(job.id)).resolves.toMatchObject({
      executionAttempts: 1,
      runState: "superseded",
    });
  });

  it("processes only the current generation and records bounded result counters", async () => {
    const repository = createInMemoryDocumentSemanticEnrichmentRepository({
      generateLeaseToken: () => uuid(22),
    });
    const job = await repository.enqueue(jobInput(uuid(11), 3));
    const processor = {
      process: vi.fn(async () => ({
        entitiesExtracted: 4,
        graphEntityIds: [uuid(31), uuid(32), uuid(33)],
        graphEntitiesIndexed: 3,
        graphRelationIds: [uuid(34)],
        graphRelationsIndexed: 1,
        nodesScanned: 8,
        semanticProviderCalls: 2,
        semanticProviderCallsMaximum: 2,
      })),
    };
    const metrics = { record: vi.fn() };
    const runtime = createDocumentSemanticEnrichmentRuntime({
      claimLimit: 1,
      generationGuard: { status: async () => "current" },
      heartbeatIntervalMs: 50,
      intervalMs: 1_000,
      leaseMs: 100,
      metrics,
      now: () => startedAt,
      processor,
      repository,
      retryBaseMs: 1_000,
      workerId: "semantic-worker",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, succeeded: 1 });
    expect(processor.process).toHaveBeenCalledOnce();
    await expect(repository.get(job.id)).resolves.toMatchObject({
      result: { graphEntitiesIndexed: 3, nodesScanned: 8 },
      runState: "succeeded",
    });
    expect(metrics.record).toHaveBeenCalledWith({
      degraded: false,
      durationMs: 0,
      executionAttempt: 1,
      nodesScanned: 8,
      outcome: "succeeded",
      providerCalls: 2,
      queueWaitMs: 0,
    });
  });

  it.each([
    [new Error("Dify model runtime request timed out"), "timeout"],
    [Object.assign(new Error("provider unavailable"), { status: 429 }), "rate_limited"],
  ] as const)("classifies degraded semantic failure telemetry", async (error, failureKind) => {
    const repository = createInMemoryDocumentSemanticEnrichmentRepository({
      generateLeaseToken: () => uuid(24),
    });
    await repository.enqueue(jobInput(uuid(13), 1));
    const metrics = { record: vi.fn() };
    const runtime = createDocumentSemanticEnrichmentRuntime({
      claimLimit: 1,
      generationGuard: { status: async () => "current" },
      heartbeatIntervalMs: 50,
      intervalMs: 1_000,
      leaseMs: 100,
      metrics,
      now: () => startedAt,
      processor: {
        process: vi.fn(async () => {
          throw error;
        }),
      },
      repository,
      retryBaseMs: 1_000,
      workerId: "semantic-worker",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ degraded: true, failureKind, outcome: "failed" }),
    );
  });

  it("supersedes stale generations without invoking the model processor", async () => {
    const repository = createInMemoryDocumentSemanticEnrichmentRepository({
      generateLeaseToken: () => uuid(23),
    });
    const job = await repository.enqueue(jobInput(uuid(12), 3));
    const processor = { process: vi.fn() };
    const runtime = createDocumentSemanticEnrichmentRuntime({
      claimLimit: 1,
      generationGuard: { status: async () => "superseded" },
      heartbeatIntervalMs: 50,
      intervalMs: 1_000,
      leaseMs: 100,
      now: () => startedAt,
      processor,
      repository,
      retryBaseMs: 1_000,
      workerId: "semantic-worker",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, superseded: 1 });
    expect(processor.process).not.toHaveBeenCalled();
    await expect(repository.get(job.id)).resolves.toMatchObject({
      lastErrorCode: "SEMANTIC_GENERATION_SUPERSEDED",
      runState: "superseded",
    });
  });
});

function jobInput(id: string, maxExecutionAttempts: number) {
  const createdAt = new Date(startedAt).toISOString();
  return {
    availableAt: createdAt,
    baseHeadRevision: 7,
    compilationAttemptId: uuid(6),
    createdAt,
    documentAssetId: uuid(2),
    documentVersion: 1,
    id,
    knowledgeSpaceId: uuid(1),
    maxExecutionAttempts,
    parseArtifactId: uuid(3),
    publicationGenerationId: uuid(4),
    retrievalProfile: {
      defaultMode: "research" as const,
      reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
      rerank: { enabled: false },
      revision: 1,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 10,
    },
    tenantId: "tenant-1",
  };
}

function sequence(values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (!value) throw new Error("Lease-token fixture exhausted");
    return value;
  };
}

function uuid(value: number): string {
  return `018f0d60-7a49-7cc2-9c1b-${value.toString().padStart(12, "0")}`;
}
