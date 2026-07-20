import { describe, expect, it } from "vitest";

import {
  type RetrievalStudioStrategyInput,
  createRetrievalStudioComparison,
} from "./retrieval-studio";

describe("createRetrievalStudioComparison", () => {
  it("builds bounded side-by-side retrieval strategy columns", () => {
    const comparison = createRetrievalStudioComparison({
      maxCandidates: 2,
      strategies: [
        {
          candidates: [
            {
              citationLabel: "policy.md#L10",
              evidenceState: "answerable",
              nodeId: "node-policy",
              rerankScore: 0.71,
              score: 0.62,
              sources: ["dense"],
              title: "Policy summary",
            },
            {
              citationLabel: "roadmap.md#L4",
              evidenceState: "partial",
              nodeId: "node-roadmap",
              score: 0.51,
              sources: ["fts"],
              title: "Roadmap note",
            },
            {
              citationLabel: "ignored.md#L1",
              evidenceState: "not-enough-evidence",
              nodeId: "node-ignored",
              score: 0.3,
              sources: ["dense"],
              title: "Ignored overflow",
            },
          ],
          evidenceBundle: {
            itemCount: 2,
            missingEvidenceCount: 1,
            state: "partial",
          },
          latencyMs: 124,
          name: "baseline",
          recallAtK: 0.5,
        },
        {
          candidates: [
            {
              citationLabel: "incident.md#L20",
              evidenceState: "answerable",
              nodeId: "node-incident",
              rerankScore: 0.93,
              score: 0.87,
              sources: ["dense", "fts"],
              title: "Incident rollback",
            },
          ],
          evidenceBundle: {
            itemCount: 3,
            missingEvidenceCount: 0,
            state: "answerable",
          },
          latencyMs: 98,
          name: "challenger",
          recallAtK: 1,
        },
      ],
    });

    expect(comparison.winner).toBe("challenger");
    expect(comparison.columns).toEqual([
      {
        averageScoreLabel: "56%",
        candidateCountLabel: "2 shown",
        candidates: [
          {
            citationLabel: "policy.md#L10",
            evidenceState: "answerable",
            nodeId: "node-policy",
            rerankScoreLabel: "71%",
            scoreLabel: "62%",
            sourcesLabel: "dense",
            title: "Policy summary",
          },
          {
            citationLabel: "roadmap.md#L4",
            evidenceState: "partial",
            nodeId: "node-roadmap",
            rerankScoreLabel: "n/a",
            scoreLabel: "51%",
            sourcesLabel: "fts",
            title: "Roadmap note",
          },
        ],
        evidenceBundleLabel: "partial - 2 evidence, 1 missing",
        latencyLabel: "124 ms",
        name: "baseline",
        recallLabel: "50%",
      },
      {
        averageScoreLabel: "87%",
        candidateCountLabel: "1 shown",
        candidates: [
          {
            citationLabel: "incident.md#L20",
            evidenceState: "answerable",
            nodeId: "node-incident",
            rerankScoreLabel: "93%",
            scoreLabel: "87%",
            sourcesLabel: "dense + fts",
            title: "Incident rollback",
          },
        ],
        evidenceBundleLabel: "answerable - 3 evidence, 0 missing",
        latencyLabel: "98 ms",
        name: "challenger",
        recallLabel: "100%",
      },
    ]);
  });

  it("rejects unbounded retrieval studio inputs", () => {
    expect(() =>
      createRetrievalStudioComparison({
        maxCandidates: 0,
        strategies: [],
      }),
    ).toThrow("Retrieval Studio maxCandidates must be at least 1");

    expect(() =>
      createRetrievalStudioComparison({
        strategies: [
          {
            candidates: [],
            evidenceBundle: { itemCount: 0, missingEvidenceCount: 0, state: "answerable" },
            latencyMs: 0,
            name: "only-one",
            recallAtK: 1,
          },
        ],
      }),
    ).toThrow("Retrieval Studio requires exactly two strategies");

    expect(() =>
      createRetrievalStudioComparison({
        strategies: [
          {
            candidates: [],
            evidenceBundle: { itemCount: 0, missingEvidenceCount: 0, state: "answerable" },
            latencyMs: 0,
            name: " ",
            recallAtK: 1,
          },
          {
            candidates: [],
            evidenceBundle: { itemCount: 0, missingEvidenceCount: 0, state: "answerable" },
            latencyMs: 0,
            name: "challenger",
            recallAtK: 1,
          },
        ],
      }),
    ).toThrow("Retrieval Studio strategy name is required");

    expect(() =>
      createRetrievalStudioComparison({
        strategies: [
          {
            candidates: [
              { citationLabel: "x", nodeId: "node", score: 1.1, sources: [], title: "x" },
            ],
            evidenceBundle: { itemCount: 0, missingEvidenceCount: 0, state: "answerable" },
            latencyMs: 0,
            name: "baseline",
            recallAtK: 1,
          },
          {
            candidates: [],
            evidenceBundle: { itemCount: 0, missingEvidenceCount: 0, state: "answerable" },
            latencyMs: 0,
            name: "challenger",
            recallAtK: 1,
          },
        ],
      }),
    ).toThrow("Retrieval Studio candidate score must be between 0 and 1");
  });

  it("handles default bounds, empty candidates, fallback labels, and tie winners", () => {
    const comparison = createRetrievalStudioComparison({
      strategies: [
        {
          ...strategyBase("baseline"),
          candidates: [
            {
              citationLabel: "empty.md#L1",
              nodeId: "node-empty",
              score: 0,
              sources: [],
              title: "No source candidate",
            },
          ],
        },
        strategyBase("challenger"),
      ],
    });

    expect(comparison.winner).toBe("tie");
    expect(comparison.columns[0]?.averageScoreLabel).toBe("0%");
    expect(comparison.columns[0]?.candidates[0]).toMatchObject({
      evidenceState: "not-enough-evidence",
      rerankScoreLabel: "n/a",
      sourcesLabel: "none",
    });
  });

  it("rounds percent labels without upward epsilon bias", () => {
    const comparison = createRetrievalStudioComparison({
      strategies: [
        {
          ...strategyBase("baseline"),
          candidates: [
            {
              citationLabel: "tiny.md#L1",
              nodeId: "node-tiny",
              score: 0.004_999_999,
              sources: ["dense"],
              title: "Tiny score",
            },
          ],
          recallAtK: 0.004_999_999,
        },
        strategyBase("challenger"),
      ],
    });

    expect(comparison.columns[0]?.recallLabel).toBe("0%");
    expect(comparison.columns[0]?.candidates[0]?.scoreLabel).toBe("0%");
  });

  it("uses score and latency as deterministic winner tie-breakers", () => {
    expect(
      createRetrievalStudioComparison({
        strategies: [
          {
            ...strategyBase("baseline"),
            candidates: [
              {
                citationLabel: "a.md#L1",
                nodeId: "node-a",
                score: 0.9,
                sources: ["dense"],
                title: "A",
              },
            ],
          },
          {
            ...strategyBase("challenger"),
            candidates: [
              {
                citationLabel: "b.md#L1",
                nodeId: "node-b",
                score: 0.5,
                sources: ["fts"],
                title: "B",
              },
            ],
          },
        ],
      }).winner,
    ).toBe("baseline");

    expect(
      createRetrievalStudioComparison({
        strategies: [
          { ...strategyBase("baseline"), latencyMs: 30 },
          { ...strategyBase("challenger"), latencyMs: 10 },
        ],
      }).winner,
    ).toBe("challenger");
  });

  it("rejects malformed strategy and candidate fields", () => {
    expect(() =>
      createRetrievalStudioComparison({
        strategies: [{ ...strategyBase("baseline"), recallAtK: -0.1 }, strategyBase("challenger")],
      }),
    ).toThrow("Retrieval Studio recallAtK must be between 0 and 1");

    expect(() =>
      createRetrievalStudioComparison({
        strategies: [{ ...strategyBase("baseline"), latencyMs: -1 }, strategyBase("challenger")],
      }),
    ).toThrow("Retrieval Studio latencyMs must be non-negative");

    expect(() =>
      createRetrievalStudioComparison({
        strategies: [
          {
            ...strategyBase("baseline"),
            evidenceBundle: { itemCount: -1, missingEvidenceCount: 0, state: "answerable" },
          },
          strategyBase("challenger"),
        ],
      }),
    ).toThrow("Retrieval Studio evidence itemCount must be non-negative");

    expect(() =>
      createRetrievalStudioComparison({
        strategies: [
          {
            ...strategyBase("baseline"),
            candidates: [
              {
                citationLabel: "x",
                nodeId: "node",
                rerankScore: 2,
                score: 0.5,
                sources: [],
                title: "x",
              },
            ],
          },
          strategyBase("challenger"),
        ],
      }),
    ).toThrow("Retrieval Studio candidate rerankScore must be between 0 and 1");
  });
});

function strategyBase(name: string): RetrievalStudioStrategyInput {
  return {
    candidates: [],
    evidenceBundle: { itemCount: 0, missingEvidenceCount: 0, state: "answerable" },
    latencyMs: 0,
    name,
    recallAtK: 1,
  };
}
