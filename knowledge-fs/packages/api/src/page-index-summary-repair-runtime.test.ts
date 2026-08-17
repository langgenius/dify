import { describe, expect, it, vi } from "vitest";

import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import {
  type PersistPageIndexFindabilityEvaluationInput,
  createInMemoryPageIndexFindabilityRepository,
} from "./page-index-findability-repository";
import { createPageIndexSummaryRepairRuntime } from "./page-index-summary-repair-runtime";

describe("PageIndex summary repair runtime", () => {
  it("repairs only the outline-summary component after the source attempt is terminal", async () => {
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    await repository.persist(evaluation());
    const repair = vi.fn(async () => undefined);
    const runtime = createPageIndexSummaryRepairRuntime({
      attempts: { get: async () => attempt("succeeded") },
      intervalMs: 1_000,
      leaseMs: 10_000,
      maxAttempts: 3,
      maxBatchSize: 10,
      repository,
      repair,
      retryBaseMs: 1_000,
      retryMaxMs: 10_000,
      workerId: "repair-worker",
      now: () => Date.parse("2026-08-06T00:00:00.000Z"),
    });

    const result = await runtime.tick();

    expect(result).toEqual({ claimed: 1, dispatched: 1, failed: 0, requeued: 0 });
    expect(repair).toHaveBeenCalledWith({
      evaluation: expect.objectContaining({ outlineId: uuid(4) }),
      source: expect.objectContaining({ id: uuid(6), publicationGenerationId: uuid(13) }),
    });
    expect(await runtime.tick()).toEqual({ claimed: 0, dispatched: 0, failed: 0, requeued: 0 });
  });

  it("requeues while the publication attempt is still active", async () => {
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    await repository.persist(evaluation());
    const repair = vi.fn();
    const runtime = createPageIndexSummaryRepairRuntime({
      attempts: { get: async () => attempt("running") },
      intervalMs: 1_000,
      leaseMs: 10_000,
      maxAttempts: 3,
      maxBatchSize: 10,
      repository,
      repair,
      retryBaseMs: 1_000,
      retryMaxMs: 10_000,
      workerId: "repair-worker",
      now: () => Date.parse("2026-08-06T00:00:00.000Z"),
    });

    expect(await runtime.tick()).toEqual({ claimed: 1, dispatched: 0, failed: 0, requeued: 1 });
    expect(repair).not.toHaveBeenCalled();
  });

  it("validates bounded worker settings", () => {
    const base = runtimeOptions({
      attempts: { get: async () => null },
      repair: vi.fn(),
      repository: createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 }),
    });
    for (const override of [
      { intervalMs: 0 },
      { leaseMs: 0 },
      { maxAttempts: 0 },
      { maxBatchSize: 0 },
      { retryBaseMs: 0 },
      { retryMaxMs: 0 },
    ]) {
      expect(() => createPageIndexSummaryRepairRuntime({ ...base, ...override })).toThrow(
        "must be a positive integer",
      );
    }
    expect(() =>
      createPageIndexSummaryRepairRuntime({ ...base, retryBaseMs: 2_000, retryMaxMs: 1_000 }),
    ).toThrow("retryMaxMs must be at least retryBaseMs");
    expect(() => createPageIndexSummaryRepairRuntime({ ...base, workerId: " " })).toThrow(
      "workerId is required",
    );
  });

  it("reports terminal dispatch failures after the bounded retry count", async () => {
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    await repository.persist(evaluation());
    let timestamp = Date.parse("2026-08-06T00:00:00.000Z");
    const onError = vi.fn();
    const runtime = createPageIndexSummaryRepairRuntime({
      ...runtimeOptions({
        attempts: { get: async () => attempt("succeeded") },
        repair: vi.fn().mockRejectedValue("provider unavailable"),
        repository,
      }),
      maxAttempts: 2,
      now: () => timestamp,
      onError,
    });

    expect(await runtime.tick()).toEqual({ claimed: 1, dispatched: 0, failed: 0, requeued: 1 });
    timestamp += 1_000;
    expect(await runtime.tick()).toEqual({ claimed: 1, dispatched: 0, failed: 1, requeued: 0 });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("deduplicates overlapping ticks and starts or stops its timer idempotently", async () => {
    let release: ((value: []) => void) | undefined;
    const claim = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          release = resolve;
        }),
    );
    const runtime = createPageIndexSummaryRepairRuntime({
      ...runtimeOptions({
        attempts: { get: async () => null },
        repair: vi.fn(),
        repository: {
          claimSummaryRepairs: claim,
          completeSummaryRepair: vi.fn(),
          failSummaryRepair: vi.fn(),
        },
      }),
    });

    const first = runtime.tick();
    const second = runtime.tick();
    expect(second).toBe(first);
    release?.([]);
    await first;

    runtime.start();
    runtime.start();
    runtime.stop();
    runtime.stop();
  });
});

function runtimeOptions({
  attempts,
  repair,
  repository,
}: Pick<
  Parameters<typeof createPageIndexSummaryRepairRuntime>[0],
  "attempts" | "repair" | "repository"
>): Parameters<typeof createPageIndexSummaryRepairRuntime>[0] {
  return {
    attempts,
    intervalMs: 1_000,
    leaseMs: 10_000,
    maxAttempts: 3,
    maxBatchSize: 10,
    now: () => Date.parse("2026-08-06T00:00:00.000Z"),
    repository,
    repair,
    retryBaseMs: 1_000,
    retryMaxMs: 10_000,
    workerId: "repair-worker",
  };
}

function evaluation(): PersistPageIndexFindabilityEvaluationInput {
  return {
    compilationAttemptId: uuid(6),
    documentAssetId: uuid(3),
    documentVersion: 1,
    evaluatedAt: "2026-08-06T00:00:00.000Z",
    evaluation: {
      abstentionRate: 1,
      evaluatorVersion: "findability-v1",
      meanReciprocalRank: 0,
      model: { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" },
      pathRecallAtK: 0,
      promptVersion: "pageindex-layered-tree-search-v1",
      recallAtK: 0,
      recommendedRoute: "hybrid",
      sampleCount: 2,
      status: "failed",
      summaryRepairRequested: true,
      topK: 3,
    },
    generationId: uuid(13),
    knowledgeSpaceId: uuid(2),
    outlineId: uuid(4),
    publicationFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    requestSummaryRepair: true,
    tenantId: "tenant-1",
  };
}

function attempt(runState: DocumentCompilationAttempt["runState"]): DocumentCompilationAttempt {
  return {
    ...(runState === "running" ? { activeSlot: 1 as const } : {}),
    baseHeadRevision: 0,
    capabilityGrantId: uuid(10),
    checkpoint: runState === "succeeded" ? "published" : "smoke_eval_passed",
    createdAt: "2026-08-06T00:00:00.000Z",
    documentAssetId: uuid(3),
    documentVersion: 1,
    executionAttempts: 1,
    id: uuid(6),
    knowledgeSpaceId: uuid(2),
    maxExecutionAttempts: 3,
    publicationGenerationId: uuid(13),
    rowVersion: 4,
    runState,
    tenantId: "tenant-1",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}
