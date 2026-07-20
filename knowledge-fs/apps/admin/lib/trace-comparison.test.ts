import { describe, expect, it } from "vitest";

import { createTraceComparison } from "./trace-comparison";

describe("createTraceComparison", () => {
  it("compares two bounded query traces for recall, rerank, filters, and evidence", () => {
    const comparison = createTraceComparison({
      maxSteps: 10,
      traces: [
        {
          id: "trace-baseline",
          label: "baseline",
          steps: [
            { attributes: { mode: "hybrid" }, name: "route.select" },
            { attributes: { count: 24 }, name: "recall.candidates" },
            { attributes: { permission: "tenant", recency: "30d" }, name: "filters.apply" },
            { attributes: { provider: "cohere", topK: 6 }, name: "rerank.apply" },
            { attributes: { citations: 2 }, name: "evidence.bundle" },
          ],
        },
        {
          id: "trace-challenger",
          label: "challenger",
          steps: [
            { attributes: { mode: "deep" }, name: "route.select" },
            { attributes: { count: 42 }, name: "recall.candidates" },
            { attributes: { permission: "tenant", recency: "90d" }, name: "filters.apply" },
            { attributes: { provider: "bge-reranker", topK: 8 }, name: "rerank.apply" },
            { attributes: { citations: 5 }, name: "evidence.bundle" },
          ],
        },
      ],
    });

    expect(comparison).toEqual({
      columns: [
        {
          evidenceLabel: "2 citations",
          filtersLabel: "permission=tenant, recency=30d",
          label: "baseline",
          recallCandidatesLabel: "24 candidates",
          rerankLabel: "cohere top 6",
          routeLabel: "hybrid",
          stepCountLabel: "5 steps",
          traceId: "trace-baseline",
        },
        {
          evidenceLabel: "5 citations",
          filtersLabel: "permission=tenant, recency=90d",
          label: "challenger",
          recallCandidatesLabel: "42 candidates",
          rerankLabel: "bge-reranker top 8",
          routeLabel: "deep",
          stepCountLabel: "5 steps",
          traceId: "trace-challenger",
        },
      ],
      deltas: {
        citationDeltaLabel: "+3 citations",
        filterChangeLabel: "permission stable, recency changed",
        recallDeltaLabel: "+18 candidates",
        rerankChangeLabel: "cohere top 6 -> bge-reranker top 8",
        routeChangeLabel: "hybrid -> deep",
      },
    });
  });

  it("rejects unbounded or malformed trace comparison inputs", () => {
    expect(() => createTraceComparison({ maxSteps: 0, traces: [] })).toThrow(
      "Trace comparison maxSteps must be at least 1",
    );
    expect(() =>
      createTraceComparison({
        traces: [{ id: "trace-a", label: "baseline", steps: [] }],
      }),
    ).toThrow("Trace comparison requires exactly two traces");
    expect(() =>
      createTraceComparison({
        maxSteps: 1,
        traces: [
          {
            id: "trace-a",
            label: "baseline",
            steps: [
              { attributes: {}, name: "route.select" },
              { attributes: {}, name: "recall.candidates" },
            ],
          },
          { id: "trace-b", label: "challenger", steps: [] },
        ],
      }),
    ).toThrow("Trace comparison trace steps exceeds maxSteps=1");
    expect(() =>
      createTraceComparison({
        traces: [
          { id: " ", label: "baseline", steps: [] },
          { id: "trace-b", label: "challenger", steps: [] },
        ],
      }),
    ).toThrow("Trace comparison trace id is required");
    expect(() =>
      createTraceComparison({
        traces: [
          { id: "trace-a", label: " ", steps: [] },
          { id: "trace-b", label: "challenger", steps: [] },
        ],
      }),
    ).toThrow("Trace comparison trace label is required");
  });

  it("handles missing and stable trace steps without leaking unbounded attributes", () => {
    const comparison = createTraceComparison({
      traces: [
        {
          id: "trace-a",
          label: "baseline",
          steps: [
            { attributes: { ignored: { nested: true } }, name: "filters.apply" },
            { attributes: { provider: "cohere", topK: 8 }, name: "rerank.apply" },
          ],
        },
        {
          id: "trace-b",
          label: "challenger",
          steps: [{ attributes: { provider: "cohere", topK: 8 }, name: "rerank.apply" }],
        },
      ],
    });

    expect(comparison.columns).toEqual([
      {
        evidenceLabel: "0 citations",
        filtersLabel: "none",
        label: "baseline",
        recallCandidatesLabel: "0 candidates",
        rerankLabel: "cohere top 8",
        routeLabel: "unknown",
        stepCountLabel: "2 steps",
        traceId: "trace-a",
      },
      {
        evidenceLabel: "0 citations",
        filtersLabel: "none",
        label: "challenger",
        recallCandidatesLabel: "0 candidates",
        rerankLabel: "cohere top 8",
        routeLabel: "unknown",
        stepCountLabel: "1 step",
        traceId: "trace-b",
      },
    ]);
    expect(comparison.deltas).toEqual({
      citationDeltaLabel: "0 citations",
      filterChangeLabel: "none stable",
      recallDeltaLabel: "0 candidates",
      rerankChangeLabel: "cohere top 8 stable",
      routeChangeLabel: "unknown stable",
    });
  });

  it("compares live query.generate traces from hybrid retrieval metadata", () => {
    const comparison = createTraceComparison({
      traces: [
        {
          id: "trace-a",
          label: "baseline",
          steps: [
            {
              attributes: {
                citations: [{ label: "node:node-1" }],
                metrics: { fusedCandidates: 1 },
                mode: "fast",
                plan: { rerankCandidateLimit: 0, resolvedMode: "fast" },
              },
              name: "query.generate",
            },
          ],
        },
        {
          id: "trace-b",
          label: "challenger",
          steps: [
            {
              attributes: {
                citations: [{ label: "node:node-1" }, { label: "node:node-2" }],
                metrics: { fusedCandidates: 2 },
                mode: "research",
                plan: { rerankCandidateLimit: 10, resolvedMode: "research" },
              },
              name: "query.generate",
            },
          ],
        },
      ],
    });

    expect(comparison.columns).toMatchObject([
      {
        evidenceLabel: "1 citations",
        recallCandidatesLabel: "1 candidates",
        rerankLabel: "disabled top 0",
        routeLabel: "fast",
      },
      {
        evidenceLabel: "2 citations",
        recallCandidatesLabel: "2 candidates",
        rerankLabel: "planned top 10",
        routeLabel: "research",
      },
    ]);
    expect(comparison.deltas).toMatchObject({
      citationDeltaLabel: "+1 citations",
      recallDeltaLabel: "+1 candidates",
      rerankChangeLabel: "disabled top 0 -> planned top 10",
      routeChangeLabel: "fast -> research",
    });
  });
});
