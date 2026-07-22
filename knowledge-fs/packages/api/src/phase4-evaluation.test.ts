import { describe, expect, it } from "vitest";

import { createPhase4EvaluationReport } from "./phase4-evaluation";

describe("createPhase4EvaluationReport", () => {
  it("reports graph, enrichment, and summary-tree impact on one golden set", () => {
    const report = createPhase4EvaluationReport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      goldenSet: {
        name: "phase-4-golden",
        totalQuestions: 10,
      },
      variants: {
        baseline: {
          citationHitRate: 0.82,
          noAnswerRate: 0.12,
          recallAtK: 0.78,
          totalQuestions: 10,
        },
        enriched: {
          citationHitRate: 0.86,
          noAnswerRate: 0.09,
          recallAtK: 0.83,
          totalQuestions: 10,
        },
        "graph-expanded": {
          citationHitRate: 0.88,
          noAnswerRate: 0.08,
          recallAtK: 0.87,
          totalQuestions: 10,
        },
        "summary-tree": {
          citationHitRate: 0.87,
          noAnswerRate: 0.08,
          recallAtK: 0.85,
          totalQuestions: 10,
        },
      },
    });

    expect(report).toEqual({
      generatedAt: "2026-05-12T00:00:00.000Z",
      goldenSet: {
        name: "phase-4-golden",
        totalQuestions: 10,
      },
      impact: {
        enrichedVsBaseline: {
          citationHitRate: 0.04,
          noAnswerRate: -0.03,
          recallAtK: 0.05,
        },
        graphExpandedVsBaseline: {
          citationHitRate: 0.06,
          noAnswerRate: -0.04,
          recallAtK: 0.09,
        },
        summaryTreeVsBaseline: {
          citationHitRate: 0.05,
          noAnswerRate: -0.04,
          recallAtK: 0.07,
        },
      },
      phase: "phase-4",
      recommendation:
        "graph-expanded is the strongest Phase 4 retrieval variant by recallAtK on phase-4-golden.",
      variants: {
        baseline: {
          citationHitRate: 0.82,
          noAnswerRate: 0.12,
          recallAtK: 0.78,
          totalQuestions: 10,
        },
        enriched: {
          citationHitRate: 0.86,
          noAnswerRate: 0.09,
          recallAtK: 0.83,
          totalQuestions: 10,
        },
        "graph-expanded": {
          citationHitRate: 0.88,
          noAnswerRate: 0.08,
          recallAtK: 0.87,
          totalQuestions: 10,
        },
        "summary-tree": {
          citationHitRate: 0.87,
          noAnswerRate: 0.08,
          recallAtK: 0.85,
          totalQuestions: 10,
        },
      },
    });
  });

  it("rejects mismatched or invalid golden-set metrics", () => {
    expect(() =>
      createPhase4EvaluationReport({
        generatedAt: "2026-05-12T00:00:00.000Z",
        goldenSet: { name: "phase-4-golden", totalQuestions: 10 },
        variants: {
          baseline: {
            citationHitRate: 0.82,
            noAnswerRate: 0.12,
            recallAtK: 0.78,
            totalQuestions: 10,
          },
          enriched: {
            citationHitRate: 0.86,
            noAnswerRate: 0.09,
            recallAtK: 0.83,
            totalQuestions: 10,
          },
          "graph-expanded": {
            citationHitRate: 0.88,
            noAnswerRate: 0.08,
            recallAtK: 0.87,
            totalQuestions: 9,
          },
          "summary-tree": {
            citationHitRate: 0.87,
            noAnswerRate: 0.08,
            recallAtK: 0.85,
            totalQuestions: 10,
          },
        },
      }),
    ).toThrow(
      "Phase 4 evaluation graph-expanded.totalQuestions must match goldenSet.totalQuestions=10",
    );

    expect(() =>
      createPhase4EvaluationReport({
        generatedAt: "",
        goldenSet: { name: "phase-4-golden", totalQuestions: 10 },
        variants: {
          baseline: {
            citationHitRate: 0.82,
            noAnswerRate: 0.12,
            recallAtK: 0.78,
            totalQuestions: 10,
          },
          enriched: {
            citationHitRate: 0.86,
            noAnswerRate: 0.09,
            recallAtK: 0.83,
            totalQuestions: 10,
          },
          "graph-expanded": {
            citationHitRate: 0.88,
            noAnswerRate: 0.08,
            recallAtK: 0.87,
            totalQuestions: 10,
          },
          "summary-tree": {
            citationHitRate: 0.87,
            noAnswerRate: 0.08,
            recallAtK: 1.2,
            totalQuestions: 10,
          },
        },
      }),
    ).toThrow("Phase 4 evaluation generatedAt is required");
  });
});
