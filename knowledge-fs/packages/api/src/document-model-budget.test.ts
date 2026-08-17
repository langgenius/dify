import { describe, expect, it } from "vitest";

import { createDocumentModelBudget, estimateDocumentModelTokens } from "./document-model-budget";

describe("document model budget", () => {
  it("accounts requests by stage and rejects the next over-budget request atomically", () => {
    const budget = createDocumentModelBudget({ maxEstimatedTokens: 10, maxRequests: 2 });

    budget.reserve({ estimatedTokens: 4, itemCount: 2, stage: "semantic-chunking" });
    budget.reserve({ estimatedTokens: 6, itemCount: 2, stage: "text-embedding" });
    expect(budget.snapshot()).toEqual({
      estimatedTokensReserved: 10,
      maxEstimatedTokens: 10,
      maxRequests: 2,
      requestsReserved: 2,
      stageRequests: { "semantic-chunking": 1, "text-embedding": 1 },
    });

    expect(() =>
      budget.reserve({ estimatedTokens: 0, itemCount: 1, stage: "visual-embedding" }),
    ).toThrow("maxRequests=2");
    expect(budget.snapshot().requestsReserved).toBe(2);
  });

  it("keeps estimated admission usage distinct from provider-reported token usage", () => {
    expect(estimateDocumentModelTokens("hello")).toBe(2);
    expect(estimateDocumentModelTokens("发票金额")).toBe(4);
    expect(estimateDocumentModelTokens("")).toBe(0);
  });
});
