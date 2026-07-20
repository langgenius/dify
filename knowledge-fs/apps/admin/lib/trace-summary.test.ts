import { describe, expect, it } from "vitest";

import { createTraceSummary } from "./trace-summary";

describe("createTraceSummary", () => {
  it("summarizes route, recall, filters, rerank, and evidence steps", () => {
    const summary = createTraceSummary({
      steps: [
        { attributes: { mode: "hybrid" }, name: "route.select" },
        { attributes: { count: 42 }, name: "recall.candidates" },
        { attributes: { permission: "tenant", tags: "release" }, name: "filters.apply" },
        { attributes: { provider: "cohere", topK: 8 }, name: "rerank.apply" },
        { attributes: { citations: 3 }, name: "evidence.bundle" },
      ],
    });

    expect(summary).toEqual({
      evidence: "3 citations",
      filters: "permission=tenant, tags=release",
      recallCandidates: 42,
      rerank: "cohere top 8",
      route: "hybrid",
    });
  });

  it("summarizes live query.generate traces from hybrid retrieval metadata", () => {
    const summary = createTraceSummary({
      steps: [
        {
          attributes: {
            citations: [{ label: "node:node-1" }],
            evidenceBundle: {
              items: [
                {
                  citations: [{ documentAssetId: "asset-1" }],
                },
              ],
            },
            metrics: {
              denseCandidates: 0,
              ftsCandidates: 1,
              fusedCandidates: 1,
            },
            mode: "fast",
            plan: {
              rerankCandidateLimit: 0,
              resolvedMode: "fast",
            },
          },
          name: "query.generate",
        },
      ],
    });

    expect(summary).toEqual({
      evidence: "1 citations",
      filters: "none",
      recallCandidates: 1,
      rerank: "disabled top 0",
      route: "fast",
    });
  });

  it("bounds trace step scans before the UI can retain very large traces", () => {
    expect(() =>
      createTraceSummary({
        maxSteps: 1,
        steps: [
          { attributes: {}, name: "route.select" },
          { attributes: {}, name: "recall.candidates" },
        ],
      }),
    ).toThrow("Trace summary exceeds maxSteps=1");
  });
});
