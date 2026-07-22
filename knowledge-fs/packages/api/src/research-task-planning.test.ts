import { describe, expect, it } from "vitest";

import {
  createResearchTaskDryRunPlanner,
  evaluateResearchTaskLimits,
} from "./research-task-planning";

describe("research task dry-run planner", () => {
  it("estimates bounded resources, tool calls, tokens, latency, cost, and budget fit", () => {
    const planner = createResearchTaskDryRunPlanner({
      retrievalPlanner: {
        plan: (input) => ({
          denseTopK: input.topK * 10,
          ftsTopK: input.topK * 10,
          fusionLimit: input.topK * 5,
          queryLanguage: "latin",
          requestedMode: input.mode ?? "research",
          rerankCandidateLimit: input.topK * 5,
          resolvedMode: "research",
          strategyVersion: "retrieval-planner-v1",
          topK: input.topK,
        }),
      },
    });

    const plan = planner.plan({
      budgetUsd: 1,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "Compare renewal risk across recent customer escalations",
      topK: 6,
    });

    expect(plan).toMatchObject({
      budget: {
        budgetUsd: 1,
        exceedsBudget: false,
      },
      estimates: {
        cacheHitProbability: expect.any(Number),
        costUsd: {
          currency: "USD",
          estimated: expect.any(Number),
          max: expect.any(Number),
          min: expect.any(Number),
        },
        latencyMs: {
          p50: expect.any(Number),
          p95: expect.any(Number),
        },
        retrievalSteps: 3,
        scannedResources: 30,
        toolCalls: 6,
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      retrievalPlan: {
        resolvedMode: "research",
        topK: 6,
      },
      strategyVersion: "research-dry-run-planner-v1",
    });
    expect(plan.estimates.cacheHitProbability).toBeGreaterThanOrEqual(0);
    expect(plan.estimates.cacheHitProbability).toBeLessThanOrEqual(1);
    expect(plan.estimates.costUsd.min).toBeLessThanOrEqual(plan.estimates.costUsd.estimated);
    expect(plan.estimates.costUsd.max).toBeGreaterThanOrEqual(plan.estimates.costUsd.estimated);
    expect(plan.steps.map((step) => step.name)).toEqual([
      "plan",
      "inspect",
      "retrieve",
      "analyze",
      "generate",
    ]);
    expect(plan.steps.find((step) => step.name === "inspect")).toMatchObject({
      estimatedToolCalls: 2,
    });
    expect(plan.steps.find((step) => step.name === "retrieve")).toMatchObject({
      estimatedToolCalls: 1,
    });
  });

  it("rejects invalid or unbounded dry-run inputs", () => {
    const planner = createResearchTaskDryRunPlanner({
      maxQueryBytes: 16,
      maxTopK: 4,
      retrievalPlanner: {
        plan: (input) => ({
          denseTopK: input.topK,
          ftsTopK: input.topK,
          fusionLimit: input.topK,
          queryLanguage: "latin",
          requestedMode: input.mode ?? "research",
          rerankCandidateLimit: 0,
          resolvedMode: "fast",
          strategyVersion: "retrieval-planner-v1",
          topK: input.topK,
        }),
      },
    });

    expect(() =>
      planner.plan({
        knowledgeSpaceId: "space",
        query: " ",
      }),
    ).toThrow("Research task dry-run query is required");
    expect(() =>
      planner.plan({
        knowledgeSpaceId: " ",
        query: "bounded",
      }),
    ).toThrow("Research task dry-run knowledgeSpaceId is required");
    expect(() =>
      planner.plan({
        knowledgeSpaceId: "space",
        query: "bounded",
        topK: 0,
      }),
    ).toThrow("Research task dry-run topK must be at least 1");
    expect(() =>
      planner.plan({
        budgetUsd: -1,
        knowledgeSpaceId: "space",
        query: "bounded",
        topK: 4,
      }),
    ).toThrow("Research task dry-run budgetUsd must be a non-negative finite number");
    expect(() =>
      planner.plan({
        knowledgeSpaceId: "space",
        query: "x".repeat(17),
      }),
    ).toThrow("Research task dry-run query exceeds maxQueryBytes=16");
    expect(() =>
      planner.plan({
        knowledgeSpaceId: "space",
        query: "bounded",
        topK: 5,
      }),
    ).toThrow("Research task dry-run topK exceeds maxTopK=4");
    expect(() =>
      createResearchTaskDryRunPlanner({
        maxQueryBytes: 0,
        retrievalPlanner: {
          plan: () => {
            throw new Error("unused");
          },
        },
      }),
    ).toThrow("Research task dry-run maxQueryBytes must be at least 1");
    expect(() =>
      createResearchTaskDryRunPlanner({
        maxTopK: 0,
        retrievalPlanner: {
          plan: () => {
            throw new Error("unused");
          },
        },
      }),
    ).toThrow("Research task dry-run maxTopK must be at least 1");
  });

  it("estimates mode and language-specific cache probability and budget overflow", () => {
    const planner = createResearchTaskDryRunPlanner({
      retrievalPlanner: {
        plan: (input) => ({
          denseTopK: input.topK,
          ftsTopK: input.topK,
          fusionLimit: input.topK,
          queryLanguage: input.query.includes("续约") ? "mixed-cjk-latin" : "latin",
          requestedMode: input.mode ?? "research",
          rerankCandidateLimit: 0,
          resolvedMode: input.mode === "fast" ? "fast" : "deep",
          strategyVersion: "retrieval-planner-v1",
          topK: input.topK,
        }),
      },
    });

    const fastPlan = planner.plan({
      knowledgeSpaceId: "space",
      mode: "fast",
      query: "renewal risk",
    });
    expect(fastPlan.estimates.cacheHitProbability).toBe(0.5);
    expect(fastPlan.estimates).toMatchObject({
      retrievalSteps: 3,
      scannedResources: 20,
    });
    expect(fastPlan.steps.find((step) => step.name === "retrieve")).toMatchObject({
      estimatedToolCalls: 3,
    });
    expect(fastPlan.budget).toEqual({ exceedsBudget: false });

    const deepMixedPlan = planner.plan({
      budgetUsd: 0,
      knowledgeSpaceId: "space",
      mode: "deep",
      query: "renewal 续约 risk",
    });
    expect(deepMixedPlan.estimates.cacheHitProbability).toBe(0.3);
    expect(deepMixedPlan.estimates).toMatchObject({
      retrievalSteps: 4,
      scannedResources: 50,
    });
    expect(deepMixedPlan.steps.find((step) => step.name === "retrieve")).toMatchObject({
      estimatedToolCalls: 6,
    });
    expect(deepMixedPlan.budget).toMatchObject({
      budgetUsd: 0,
      exceedsBudget: true,
    });
  });

  it("uses configurable LLM token prices instead of hard-coded model pricing", () => {
    const planner = createResearchTaskDryRunPlanner({
      llmPricing: {
        inputPerTokenUsd: 0.000001,
        outputPerTokenUsd: 0.000002,
      },
      retrievalPlanner: {
        plan: (input) => ({
          denseTopK: input.topK,
          ftsTopK: input.topK,
          fusionLimit: input.topK,
          queryLanguage: "latin",
          requestedMode: input.mode ?? "research",
          rerankCandidateLimit: 0,
          resolvedMode: "research",
          strategyVersion: "retrieval-planner-v1",
          topK: input.topK,
        }),
      },
    });

    const plan = planner.plan({
      knowledgeSpaceId: "space",
      query: "short query",
      topK: 1,
    });
    const expectedCost = plan.steps.reduce(
      (total, step) =>
        total +
        (step.estimatedInputTokens === 0 && step.estimatedOutputTokens === 0
          ? step.estimatedCostUsd
          : step.estimatedInputTokens * 0.000001 + step.estimatedOutputTokens * 0.000002),
      0,
    );

    expect(plan.estimates.costUsd.estimated).toBe(Math.round(expectedCost * 1_000_000) / 1_000_000);
  });

  it("reports timeout, retrieval-step, scanned-resource, and tool-call limit violations", () => {
    const planner = createResearchTaskDryRunPlanner({
      retrievalPlanner: {
        plan: (input) => ({
          denseTopK: input.topK * 10,
          ftsTopK: input.topK * 10,
          fusionLimit: input.topK * 5,
          queryLanguage: "latin",
          requestedMode: input.mode ?? "research",
          rerankCandidateLimit: input.topK * 5,
          resolvedMode: "research",
          strategyVersion: "retrieval-planner-v1",
          topK: input.topK,
        }),
      },
    });
    const plan = planner.plan({
      knowledgeSpaceId: "space",
      query: "bounded research limits",
      topK: 5,
    });

    expect(
      evaluateResearchTaskLimits(plan, {
        maxRetrievalSteps: 2,
        maxScannedResources: plan.estimates.scannedResources - 1,
        maxToolCalls: plan.estimates.toolCalls - 1,
        timeoutMs: plan.estimates.latencyMs.p95 - 1,
      }),
    ).toEqual({
      allowed: false,
      violations: [
        {
          estimatedValue: plan.estimates.latencyMs.p95,
          limit: "timeoutMs",
          limitValue: plan.estimates.latencyMs.p95 - 1,
        },
        {
          estimatedValue: plan.estimates.retrievalSteps,
          limit: "maxRetrievalSteps",
          limitValue: 2,
        },
        {
          estimatedValue: plan.estimates.scannedResources,
          limit: "maxScannedResources",
          limitValue: plan.estimates.scannedResources - 1,
        },
        {
          estimatedValue: plan.estimates.toolCalls,
          limit: "maxToolCalls",
          limitValue: plan.estimates.toolCalls - 1,
        },
      ],
    });
    expect(
      evaluateResearchTaskLimits(plan, {
        maxRetrievalSteps: plan.estimates.retrievalSteps,
        maxScannedResources: plan.estimates.scannedResources,
        maxToolCalls: plan.estimates.toolCalls,
        timeoutMs: plan.estimates.latencyMs.p95,
      }),
    ).toEqual({ allowed: true, violations: [] });
    expect(() => evaluateResearchTaskLimits(plan, { maxToolCalls: 0 })).toThrow(
      "Research task limit maxToolCalls must be at least 1",
    );
  });
});
