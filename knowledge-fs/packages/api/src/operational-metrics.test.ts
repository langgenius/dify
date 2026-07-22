import { describe, expect, it, vi } from "vitest";

import {
  buildRetrievalOperationalMetric,
  recordDurableTaskOperationalMetric,
  recordRetrievalOperationalMetric,
} from "./operational-metrics";
import type { HybridRetrievalResult, RetrievalMode, RetrieveHybridInput } from "./retrieval-types";

describe("KnowledgeFS operational metric adapters", () => {
  it.each([
    ["fast", "fast"],
    ["deep", "deep"],
    ["research", "research"],
    ["auto", "deep"],
  ] as const)("builds bounded %s retrieval result metrics", (requestedMode, resolvedMode) => {
    const metric = buildRetrievalOperationalMetric({
      input: retrievalInput(requestedMode, resolvedMode),
      result: retrievalResult(requestedMode, resolvedMode),
    });

    expect(metric).toEqual({
      candidateCount: 7,
      filteredCount: 4,
      mode: requestedMode,
      rerankMs: 13,
      resolvedMode,
      resultCount: 0,
      zeroResult: true,
    });
    const serialized = JSON.stringify(metric);
    for (const forbidden of [
      "tenant-1",
      "space-1",
      "task-1",
      "token",
      "https://",
      "provider failed with customer payload",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("isolates synchronous and asynchronous metric sink failures", async () => {
    const input = retrievalInput("fast", "fast");
    const result = retrievalResult("fast", "fast");

    expect(() =>
      recordRetrievalOperationalMetric(
        {
          record: () => {
            throw new Error("collector unavailable");
          },
        },
        input,
        result,
      ),
    ).not.toThrow();
    expect(() =>
      recordDurableTaskOperationalMetric(
        { record: vi.fn(() => Promise.reject(new Error("collector unavailable"))) },
        { lifecycle: "terminal", outcome: "failed", taskKind: "research" },
      ),
    ).not.toThrow();
    await Promise.resolve();
  });

  it("uses safe zero-valued defaults when optional diagnostics are absent or non-finite", () => {
    expect(
      buildRetrievalOperationalMetric({
        input: {
          knowledgeSpaceId: "space-1",
          limit: 5,
          query: "policy",
          queryVector: [0.1],
          topK: 5,
        },
        result: {
          items: [],
          metrics: {
            denseCandidates: Number.NaN,
            denseMs: 0,
            ftsCandidates: Number.POSITIVE_INFINITY,
            ftsMs: 0,
            fusedCandidates: -1,
            fusionMs: 0,
            rerankMs: -5,
            totalMs: 0,
          },
        },
      }),
    ).toEqual({
      candidateCount: 0,
      filteredCount: 0,
      mode: "fast",
      rerankMs: 0,
      resolvedMode: "fast",
      resultCount: 0,
      zeroResult: true,
    });
  });
});

function retrievalInput(
  requestedMode: RetrievalMode,
  resolvedMode: "deep" | "fast" | "research",
): RetrieveHybridInput {
  return {
    knowledgeSpaceId: "space-1",
    limit: 5,
    mode: resolvedMode,
    query: "provider failed with customer payload https://example.invalid/token",
    queryVector: [0.1],
    requestedMode,
    tenantId: "tenant-1",
    topK: 10,
    traceId: "task-1",
  };
}

function retrievalResult(
  requestedMode: RetrievalMode,
  resolvedMode: "deep" | "fast" | "research",
): HybridRetrievalResult {
  return {
    items: [],
    metrics: {
      denseCandidates: 4,
      denseMs: 2,
      ftsCandidates: 3,
      ftsMs: 1,
      fusedCandidates: 5,
      fusionMs: 1,
      metadataFilteredCandidates: 1,
      permissionFilteredCandidates: 1,
      projectionFilteredCandidates: 1,
      rerankCandidates: 5,
      rerankMs: 13,
      scoreThresholdFilteredCandidates: 1,
      totalMs: 17,
    },
    plan: {
      denseTopK: resolvedMode === "research" ? 0 : 10,
      ftsTopK: resolvedMode === "research" ? 0 : 10,
      fusionLimit: resolvedMode === "research" ? 0 : 10,
      queryLanguage: "latin",
      requestedMode,
      rerankCandidateLimit: resolvedMode === "research" ? 0 : 10,
      resolvedMode,
      strategyVersion: "retrieval-planner-v1",
      topK: 10,
    },
  };
}
