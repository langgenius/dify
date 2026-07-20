import { describe, expect, it } from "vitest";

import {
  abRetrievalWinner,
  validateAbRetrievalStrategies,
  validatePositiveIntegerBound,
  validateRetrievalEvaluationBounds,
  validateRetrievalEvaluationRunnerOptions,
  validateZeroToOne,
} from "./retrieval-evaluation-utils";

const retriever = {};

describe("retrieval evaluation utils", () => {
  it("validates runner options and per-run bounds", () => {
    expect(() =>
      validateRetrievalEvaluationRunnerOptions({
        embeddingModel: "embed-v1",
        maxQuestions: 10,
        maxTopK: 5,
      }),
    ).not.toThrow();
    expect(() =>
      validateRetrievalEvaluationBounds({ limit: 3, maxQuestions: 10, maxTopK: 5, topK: 2 }),
    ).not.toThrow();
    expect(() =>
      validateRetrievalEvaluationRunnerOptions({
        embeddingModel: " ",
        maxQuestions: 10,
        maxTopK: 5,
      }),
    ).toThrow("Retrieval evaluation embeddingModel must not be empty");
    expect(() =>
      validateRetrievalEvaluationBounds({ limit: 11, maxQuestions: 10, maxTopK: 5, topK: 2 }),
    ).toThrow("Retrieval evaluation question limit exceeds maxQuestions=10");
    expect(() =>
      validateRetrievalEvaluationBounds({ limit: 3, maxQuestions: 10, maxTopK: 5, topK: 6 }),
    ).toThrow("Retrieval evaluation topK exceeds maxTopK=5");
  });

  it("validates generic numeric bounds", () => {
    expect(() => validatePositiveIntegerBound(1, "Limit")).not.toThrow();
    expect(() => validatePositiveIntegerBound(0, "Limit")).toThrow("Limit must be at least 1");
    expect(() => validateZeroToOne(0.5, "Score")).not.toThrow();
    expect(() => validateZeroToOne(1.1, "Score")).toThrow("Score must be between 0 and 1");
  });

  it("normalizes and validates two A/B strategies", () => {
    const [baseline, challenger] = validateAbRetrievalStrategies([
      { name: " Baseline ", retriever },
      { name: " Challenger ", retriever },
    ]);

    expect(baseline).toEqual({ name: "Baseline", retriever });
    expect(challenger).toEqual({ name: "Challenger", retriever });
    expect(() => validateAbRetrievalStrategies([{ name: "one", retriever }])).toThrow(
      "A/B retrieval strategy comparison requires exactly two strategies",
    );
    expect(() =>
      validateAbRetrievalStrategies([
        { name: "same", retriever },
        { name: "same", retriever },
      ]),
    ).toThrow("A/B retrieval strategy comparison strategy names must be unique");
  });

  it("selects the A/B winner by recall, citation hit rate, then no-answer rate", () => {
    const baseline = { citationHitRate: 0.8, noAnswerRate: 0.1, recallAtK: 0.7 };

    expect(
      abRetrievalWinner(baseline, { citationHitRate: 0.1, noAnswerRate: 0.9, recallAtK: 0.8 }),
    ).toBe("challenger");
    expect(
      abRetrievalWinner(baseline, { citationHitRate: 0.9, noAnswerRate: 0.1, recallAtK: 0.7 }),
    ).toBe("challenger");
    expect(
      abRetrievalWinner(baseline, { citationHitRate: 0.8, noAnswerRate: 0.2, recallAtK: 0.7 }),
    ).toBe("baseline");
    expect(
      abRetrievalWinner(baseline, { citationHitRate: 0.8, noAnswerRate: 0.1, recallAtK: 0.7 }),
    ).toBe("tie");
  });
});
