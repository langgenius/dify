import { describe, expect, it } from "vitest";

import { createFailedQueryDiagnostics } from "./failed-query-diagnostics";

describe("createFailedQueryDiagnostics", () => {
  it("explains bounded candidate ranking, filter exclusions, and rerank drops", () => {
    const diagnostics = createFailedQueryDiagnostics({
      maxCandidates: 2,
      maxExclusions: 2,
      query: "Why did the query miss rollback evidence?",
      traceId: "trace-failed",
      candidates: [
        {
          id: "node-policy",
          finalRank: 1,
          finalScore: 0.72,
          retrievalRank: 3,
          retrievalScore: 0.61,
          rerankRank: 1,
          title: "Policy summary",
        },
        {
          id: "node-roadmap",
          finalRank: 2,
          finalScore: 0.64,
          retrievalRank: 1,
          retrievalScore: 0.89,
          rerankRank: 4,
          title: "Roadmap note",
        },
        {
          id: "node-overflow",
          finalRank: 3,
          finalScore: 0.32,
          retrievalRank: 2,
          retrievalScore: 0.7,
          title: "Overflow candidate",
        },
      ],
      exclusions: [
        {
          id: "node-hidden",
          reason: "permission",
          source: "permission filter",
          title: "Hidden evidence",
        },
        {
          id: "node-stale",
          reason: "stale",
          source: "freshness filter",
          title: "Stale evidence",
        },
        {
          id: "node-overflow-exclusion",
          reason: "metadata",
          source: "metadata filter",
          title: "Overflow exclusion",
        },
      ],
    });

    expect(diagnostics).toEqual({
      candidateRows: [
        {
          finalRankLabel: "#1",
          finalScoreLabel: "72%",
          id: "node-policy",
          rankingExplanation: "retrieval #3 -> rerank #1",
          title: "Policy summary",
        },
        {
          finalRankLabel: "#2",
          finalScoreLabel: "64%",
          id: "node-roadmap",
          rankingExplanation: "retrieval #1 -> rerank #4, dropped 3",
          title: "Roadmap note",
        },
      ],
      exclusionRows: [
        {
          id: "node-hidden",
          reasonLabel: "permission via permission filter",
          title: "Hidden evidence",
        },
        {
          id: "node-stale",
          reasonLabel: "stale via freshness filter",
          title: "Stale evidence",
        },
      ],
      summary: {
        candidateCountLabel: "2 shown of 3",
        exclusionCountLabel: "2 shown of 3",
        topIssue: "Rerank dropped 1 candidate after strong retrieval",
        traceId: "trace-failed",
      },
    });
  });

  it("rejects unbounded failed query diagnostic inputs", () => {
    expect(() =>
      createFailedQueryDiagnostics({
        maxCandidates: 0,
        maxExclusions: 1,
        query: "x",
        traceId: "trace",
        candidates: [],
        exclusions: [],
      }),
    ).toThrow("Failed query diagnostics maxCandidates must be at least 1");
    expect(() =>
      createFailedQueryDiagnostics({
        maxCandidates: 1,
        maxExclusions: 0,
        query: "x",
        traceId: "trace",
        candidates: [],
        exclusions: [],
      }),
    ).toThrow("Failed query diagnostics maxExclusions must be at least 1");
    expect(() =>
      createFailedQueryDiagnostics({
        maxCandidates: 1,
        maxExclusions: 1,
        query: " ",
        traceId: "trace",
        candidates: [],
        exclusions: [],
      }),
    ).toThrow("Failed query diagnostics query is required");
  });

  it("rounds percent labels without upward epsilon bias", () => {
    const diagnostics = createFailedQueryDiagnostics({
      candidates: [
        {
          id: "node-tiny",
          finalRank: 1,
          finalScore: 0.004_999_999,
          retrievalRank: 1,
          retrievalScore: 0.004_999_999,
          title: "Tiny score",
        },
      ],
      exclusions: [],
      query: "tiny score",
      traceId: "trace-tiny",
    });

    expect(diagnostics.candidateRows[0]?.finalScoreLabel).toBe("0%");
  });
});
