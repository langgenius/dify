import { describe, expect, it } from "vitest";

import { createRetrievalRegressionGate } from "./retrieval-regression";

const thresholds = {
  maxCitationHitRateDrop: 0.05,
  maxFailures: 20,
  maxNoAnswerRate: 0.2,
  maxNoAnswerRateIncrease: 0.05,
  maxRecallAtKDrop: 0.05,
  minCitationHitRate: 0.8,
  minQuestions: 3,
  minRecallAtK: 0.85,
};

describe("createRetrievalRegressionGate", () => {
  it("passes when current recall and citation metrics meet thresholds", () => {
    const gate = createRetrievalRegressionGate(thresholds);

    expect(
      gate.evaluate({
        baseline: {
          citationHitRate: 0.9,
          noAnswerRate: 0.05,
          recallAtK: 0.9,
          totalQuestions: 10,
        },
        current: {
          citationHitRate: 0.88,
          noAnswerRate: 0.06,
          recallAtK: 0.89,
          totalQuestions: 10,
        },
      }),
    ).toEqual({
      deltas: {
        citationHitRate: -0.02,
        noAnswerRate: 0.01,
        recallAtK: -0.01,
      },
      failures: [],
      passed: true,
    });
  });

  it("fails severe recall, citation, no-answer, and sample-size regressions", () => {
    const gate = createRetrievalRegressionGate({
      ...thresholds,
      maxFailures: 3,
      minQuestions: 5,
    });

    const result = gate.evaluate({
      baseline: {
        citationHitRate: 0.9,
        noAnswerRate: 0.05,
        recallAtK: 0.92,
        totalQuestions: 10,
      },
      current: {
        citationHitRate: 0.72,
        noAnswerRate: 0.3,
        recallAtK: 0.7,
        totalQuestions: 3,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      "totalQuestions 3 is below minQuestions 5",
      "recallAtK 0.700 is below minRecallAtK 0.850",
      "citationHitRate 0.720 is below minCitationHitRate 0.800",
    ]);
  });

  it("fails no-answer and baseline delta regressions when not clipped", () => {
    const gate = createRetrievalRegressionGate(thresholds);

    expect(
      gate.evaluate({
        baseline: {
          citationHitRate: 0.9,
          noAnswerRate: 0.05,
          recallAtK: 0.92,
          totalQuestions: 10,
        },
        current: {
          citationHitRate: 0.72,
          noAnswerRate: 0.3,
          recallAtK: 0.7,
          totalQuestions: 10,
        },
      }).failures,
    ).toContain("noAnswerRate 0.300 exceeds maxNoAnswerRate 0.200");
  });

  it("fails faithfulness and citation accuracy regressions when advanced thresholds are configured", () => {
    const gate = createRetrievalRegressionGate({
      ...thresholds,
      maxCitationAccuracyDrop: 0.03,
      maxFaithfulnessScoreDrop: 0.04,
      minCitationAccuracy: 0.85,
      minFaithfulnessScore: 0.9,
    } as Parameters<typeof createRetrievalRegressionGate>[0]);

    const result = gate.evaluate({
      baseline: {
        citationAccuracy: 0.91,
        citationHitRate: 0.9,
        faithfulnessScore: 0.95,
        noAnswerRate: 0.05,
        recallAtK: 0.92,
        totalQuestions: 10,
      },
      current: {
        citationAccuracy: 0.8,
        citationHitRate: 0.88,
        faithfulnessScore: 0.86,
        noAnswerRate: 0.05,
        recallAtK: 0.9,
        totalQuestions: 10,
      },
    });

    expect(result.deltas).toEqual({
      citationAccuracy: -0.11,
      citationHitRate: -0.02,
      faithfulnessScore: -0.09,
      noAnswerRate: 0,
      recallAtK: -0.02,
    });
    expect(result.failures).toEqual([
      "citationAccuracy 0.800 is below minCitationAccuracy 0.850",
      "faithfulnessScore 0.860 is below minFaithfulnessScore 0.900",
      "citationAccuracy dropped by 0.110 which exceeds maxCitationAccuracyDrop 0.030",
      "faithfulnessScore dropped by 0.090 which exceeds maxFaithfulnessScoreDrop 0.040",
    ]);
    expect(result.passed).toBe(false);
  });

  it("requires advanced metrics when advanced thresholds are configured", () => {
    const gate = createRetrievalRegressionGate({
      ...thresholds,
      minFaithfulnessScore: 0.9,
    } as Parameters<typeof createRetrievalRegressionGate>[0]);

    expect(() =>
      gate.evaluate({
        current: {
          citationHitRate: 0.88,
          noAnswerRate: 0.06,
          recallAtK: 0.89,
          totalQuestions: 10,
        },
      }),
    ).toThrow(
      "Retrieval regression current.faithfulnessScore is required when faithfulness thresholds are configured",
    );
  });

  it("passes without a baseline by using zero deltas", () => {
    const gate = createRetrievalRegressionGate(thresholds);

    expect(
      gate.evaluate({
        current: {
          citationHitRate: 0.88,
          noAnswerRate: 0.06,
          recallAtK: 0.89,
          totalQuestions: 10,
        },
      }),
    ).toEqual({
      deltas: {
        citationHitRate: 0,
        noAnswerRate: 0,
        recallAtK: 0,
      },
      failures: [],
      passed: true,
    });
  });

  it("rejects invalid thresholds and metric input", () => {
    expect(() =>
      createRetrievalRegressionGate({
        ...thresholds,
        minRecallAtK: 1.1,
      }),
    ).toThrow("Retrieval regression minRecallAtK must be between 0 and 1");

    expect(() =>
      createRetrievalRegressionGate({
        ...thresholds,
        maxFailures: 0,
      }),
    ).toThrow("Retrieval regression maxFailures must be at least 1");

    expect(() =>
      createRetrievalRegressionGate({
        ...thresholds,
        minQuestions: 0,
      }),
    ).toThrow("Retrieval regression minQuestions must be at least 1");

    expect(() =>
      createRetrievalRegressionGate({
        ...thresholds,
        minFaithfulnessScore: -0.1,
      }),
    ).toThrow("Retrieval regression minFaithfulnessScore must be between 0 and 1");

    const gate = createRetrievalRegressionGate(thresholds);

    expect(() =>
      gate.evaluate({
        baseline: {
          citationHitRate: 0.9,
          noAnswerRate: 0.05,
          recallAtK: Number.NaN,
          totalQuestions: 10,
        },
        current: {
          citationHitRate: 0.88,
          noAnswerRate: 0.06,
          recallAtK: 0.89,
          totalQuestions: -1,
        },
      }),
    ).toThrow("Retrieval regression current.totalQuestions must be non-negative");
  });

  it("rejects invalid baseline metrics after current metrics pass validation", () => {
    const gate = createRetrievalRegressionGate(thresholds);

    expect(() =>
      gate.evaluate({
        baseline: {
          citationHitRate: 0.9,
          noAnswerRate: 0.05,
          recallAtK: Number.NaN,
          totalQuestions: 10,
        },
        current: {
          citationHitRate: 0.88,
          noAnswerRate: 0.06,
          recallAtK: 0.89,
          totalQuestions: 10,
        },
      }),
    ).toThrow("Retrieval regression baseline.recallAtK must be between 0 and 1");
  });
});
