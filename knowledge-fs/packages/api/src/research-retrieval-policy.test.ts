import { describe, expect, it } from "vitest";

import {
  DurableResearchEvidenceRetrievalPolicy,
  DurableResearchRetrievalPolicy,
  InteractiveResearchEvidenceRetrievalPolicy,
  InteractiveResearchRetrievalPolicy,
  createResearchRetrievalBudget,
  estimateResearchRetrievalWork,
  validateResearchRetrievalPolicy,
} from "./research-retrieval-policy";

describe("Research retrieval execution policy", () => {
  it("keeps interactive work single-round and gives durable tasks bounded replay checkpoints", () => {
    expect(InteractiveResearchRetrievalPolicy).toMatchObject({
      checkpointMode: "none",
      kind: "interactive",
      maxRounds: 1,
      maxSupplementalSearches: 1,
      maxTreeDepth: 6,
    });
    expect(DurableResearchRetrievalPolicy).toMatchObject({
      checkpointMode: "replay-safe-boundaries",
      kind: "durable",
      maxTreeDepth: 12,
    });
    expect(DurableResearchRetrievalPolicy.maxRounds).toBeGreaterThan(1);
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        maxRounds: 2,
      }),
    ).toThrow("interactive maxRounds must equal 1");
  });

  it("caps fresh Evidence V3 retrieval at two model calls and one durable supplement", () => {
    expect(InteractiveResearchEvidenceRetrievalPolicy).toMatchObject({
      kind: "interactive",
      maxModelCalls: 2,
      maxRounds: 1,
      maxSupplementalSearches: 0,
      strategyVersion: "research-evidence-v3",
    });
    expect(DurableResearchEvidenceRetrievalPolicy).toMatchObject({
      kind: "durable",
      maxModelCalls: 2,
      maxRounds: 2,
      maxSupplementalSearches: 1,
      strategyVersion: "research-evidence-v3",
    });
    expect(
      estimateResearchRetrievalWork(DurableResearchEvidenceRetrievalPolicy, {
        includeFinalSynthesis: true,
      }),
    ).toMatchObject({
      expected: { modelCalls: 3 },
      maximum: { modelCalls: 3 },
      minimum: { modelCalls: 2 },
    });
  });

  it("enforces actual runtime counters and wall time without exceeding a hard limit", () => {
    let now = 1_000;
    const budget = createResearchRetrievalBudget(
      {
        ...InteractiveResearchRetrievalPolicy,
        maxModelCalls: 2,
        maxOpenedResources: 3,
        maxRetrievalSteps: 2,
        wallClockMs: 100,
      },
      () => now,
    );

    expect(budget.consume("modelCalls", 2)).toBe(true);
    expect(budget.consume("modelCalls", 1)).toBe(false);
    expect(budget.consume("openedResources", 3)).toBe(true);
    now = 1_101;
    expect(budget.consume("retrievalSteps", 1)).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      exhaustedReasons: ["model-calls", "wall-clock"],
      modelCalls: 2,
      openedResources: 3,
    });
  });

  it("derives minimum, expected, and maximum work from policy bounds", () => {
    const estimate = estimateResearchRetrievalWork(DurableResearchRetrievalPolicy, {
      includeFinalSynthesis: true,
    });

    expect(estimate.minimum.modelCalls).toBeLessThanOrEqual(estimate.expected.modelCalls);
    expect(estimate.expected.modelCalls).toBeLessThanOrEqual(estimate.maximum.modelCalls);
    expect(estimate.maximum.modelCalls).toBe(DurableResearchRetrievalPolicy.maxModelCalls + 1);
    expect(estimate.maximum.openedResources).toBe(
      DurableResearchRetrievalPolicy.maxOpenedResources,
    );
    expect(estimate.maximum.retrievalSteps).toBe(DurableResearchRetrievalPolicy.maxRetrievalSteps);
  });

  it("scales dry-run model work with the bounded layered traversal depth", () => {
    const shallow = estimateResearchRetrievalWork(
      { ...DurableResearchRetrievalPolicy, maxTreeDepth: 1 },
      { includeFinalSynthesis: true },
    );
    const deeper = estimateResearchRetrievalWork(
      { ...DurableResearchRetrievalPolicy, maxTreeDepth: 4 },
      { includeFinalSynthesis: true },
    );

    expect(shallow.expected.modelCalls).toBe(7);
    expect(deeper.expected.modelCalls).toBe(17);
    expect(deeper.expected.modelCalls).toBeLessThanOrEqual(deeper.maximum.modelCalls);
  });

  it("restores cumulative durable counters without counting retry wait time", () => {
    let now = 10_000;
    const budget = createResearchRetrievalBudget(
      {
        ...DurableResearchRetrievalPolicy,
        maxModelCalls: 3,
        wallClockMs: 1_000,
      },
      () => now,
      {
        elapsedMs: 400,
        exhaustedReasons: [],
        modelCalls: 2,
        openedResources: 1,
        retrievalSteps: 2,
        rounds: 1,
        supplementalSearches: 0,
      },
    );

    expect(budget.consume("modelCalls")).toBe(true);
    expect(budget.consume("modelCalls")).toBe(false);
    now += 500;
    expect(budget.snapshot()).toMatchObject({ elapsedMs: 900, modelCalls: 3 });
  });

  it("rejects malformed interactive and durable policies", () => {
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        maxDocuments: 0,
      }),
    ).toThrow("maxDocuments must be a positive integer");
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        maxDocuments: 1.5,
      }),
    ).toThrow("maxDocuments must be a positive integer");
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        maxSupplementalSearches: -1,
      }),
    ).toThrow("maxSupplementalSearches must be a non-negative integer");
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        maxSupplementalSearches: 0.5,
      }),
    ).toThrow("maxSupplementalSearches must be a non-negative integer");
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        checkpointMode: "replay-safe-boundaries",
      }),
    ).toThrow("interactive checkpointMode must equal none");
    expect(() =>
      validateResearchRetrievalPolicy({
        ...InteractiveResearchRetrievalPolicy,
        maxSupplementalSearches: 2,
      }),
    ).toThrow("interactive maxSupplementalSearches must not exceed 1");
    expect(() =>
      validateResearchRetrievalPolicy({
        ...DurableResearchRetrievalPolicy,
        checkpointMode: "none",
      }),
    ).toThrow("durable checkpointMode must equal replay-safe-boundaries");
  });

  it("validates restored snapshots, reservations, refunds, and every exhaustion reason", () => {
    const initial = {
      elapsedMs: 0,
      exhaustedReasons: [] as const,
      modelCalls: 0,
      openedResources: 0,
      retrievalSteps: 0,
      rounds: 0,
      supplementalSearches: 0,
    };
    expect(() =>
      createResearchRetrievalBudget(InteractiveResearchRetrievalPolicy, () => 0, {
        ...initial,
        elapsedMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("initial elapsedMs must be non-negative and finite");
    expect(() =>
      createResearchRetrievalBudget(InteractiveResearchRetrievalPolicy, () => 0, {
        ...initial,
        elapsedMs: -1,
      }),
    ).toThrow("initial elapsedMs must be non-negative and finite");
    expect(() =>
      createResearchRetrievalBudget(InteractiveResearchRetrievalPolicy, () => 0, {
        ...initial,
        rounds: 2,
      }),
    ).toThrow("initial rounds is outside the policy limit");
    expect(() =>
      createResearchRetrievalBudget(InteractiveResearchRetrievalPolicy, () => 0, {
        ...initial,
        modelCalls: 0.5,
      }),
    ).toThrow("initial modelCalls is outside the policy limit");
    expect(() =>
      createResearchRetrievalBudget(InteractiveResearchRetrievalPolicy, () => 0, {
        ...initial,
        openedResources: -1,
      }),
    ).toThrow("initial openedResources is outside the policy limit");

    const policy = {
      ...InteractiveResearchRetrievalPolicy,
      maxModelCalls: 1,
      maxOpenedResources: 1,
      maxRetrievalSteps: 1,
      maxSupplementalSearches: 0,
    };
    const budget = createResearchRetrievalBudget(policy, () => 0);
    expect(() => budget.consume("modelCalls", 0)).toThrow(
      "budget consumption must be a positive integer",
    );
    expect(() => budget.consume("modelCalls", 1.5)).toThrow(
      "budget consumption must be a positive integer",
    );
    expect(() => budget.refund("modelCalls", 0)).toThrow(
      "budget refund must be a positive integer",
    );
    expect(() => budget.refund("modelCalls", 1.5)).toThrow(
      "budget refund must be a positive integer",
    );

    for (const counter of [
      "modelCalls",
      "openedResources",
      "retrievalSteps",
      "rounds",
      "supplementalSearches",
    ] as const) {
      expect(budget.consume(counter, 2)).toBe(false);
    }
    budget.refund("modelCalls", 2);
    expect(budget.snapshot()).toMatchObject({
      exhaustedReasons: [
        "model-calls",
        "opened-resources",
        "retrieval-steps",
        "rounds",
        "supplemental-searches",
      ],
      modelCalls: 0,
    });
  });

  it("estimates retrieval without final synthesis and honors small policy bounds", () => {
    const estimate = estimateResearchRetrievalWork(
      {
        ...InteractiveResearchRetrievalPolicy,
        maxDocuments: 1,
        maxModelCalls: 1,
        maxOpenedResources: 1,
        maxQueueItems: 1,
        maxRetrievalSteps: 1,
        maxSupplementalSearches: 0,
        maxTreeDepth: 1,
      },
      { includeFinalSynthesis: false },
    );

    expect(estimate).toEqual({
      expected: { modelCalls: 1, openedResources: 1, retrievalSteps: 1 },
      maximum: { modelCalls: 1, openedResources: 1, retrievalSteps: 1 },
      minimum: { modelCalls: 0, openedResources: 0, retrievalSteps: 1 },
    });
  });
});
