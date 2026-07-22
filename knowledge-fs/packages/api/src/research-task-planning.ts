export type ResearchTaskPlanMode = "auto" | "deep" | "fast" | "research";
export type ResearchTaskResolvedMode = Exclude<ResearchTaskPlanMode, "auto">;
export type ResearchTaskQueryLanguage = "cjk" | "latin" | "mixed-cjk-latin" | "other";

export interface ResearchTaskRetrievalPlanInput {
  readonly mode?: ResearchTaskPlanMode | undefined;
  readonly query: string;
  readonly resolvedMode?: ResearchTaskResolvedMode | undefined;
  readonly topK: number;
  readonly traceId?: string | undefined;
}

export interface ResearchTaskRetrievalPlan {
  readonly denseTopK: number;
  readonly ftsTopK: number;
  readonly fusionLimit: number;
  readonly queryLanguage: ResearchTaskQueryLanguage;
  readonly requestedMode: ResearchTaskPlanMode;
  readonly rerankCandidateLimit: number;
  readonly resolvedMode: ResearchTaskResolvedMode;
  readonly strategyVersion: string;
  readonly topK: number;
}

export interface ResearchTaskRetrievalPlanner {
  plan(input: ResearchTaskRetrievalPlanInput): ResearchTaskRetrievalPlan;
}

export interface ResearchTaskDryRunPlannerOptions {
  readonly llmPricing?: ResearchTaskLlmPricing | undefined;
  readonly maxQueryBytes?: number | undefined;
  readonly maxTopK?: number | undefined;
  readonly retrievalPlanner: ResearchTaskRetrievalPlanner;
}

export interface ResearchTaskLlmPricing {
  readonly inputPerTokenUsd: number;
  readonly outputPerTokenUsd: number;
}

export interface ResearchTaskDryRunPlanInput {
  readonly budgetUsd?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode?: ResearchTaskPlanMode | undefined;
  readonly query: string;
  readonly resolvedMode?: ResearchTaskResolvedMode | undefined;
  readonly topK?: number | undefined;
  readonly traceId?: string | undefined;
}

export interface ResearchTaskDryRunPlan {
  readonly budget: {
    readonly budgetUsd?: number | undefined;
    readonly exceedsBudget: boolean;
    readonly remainingBudgetUsd?: number | undefined;
  };
  readonly estimates: {
    readonly cacheHitProbability: number;
    readonly costUsd: {
      readonly currency: "USD";
      readonly estimated: number;
      readonly max: number;
      readonly min: number;
    };
    readonly inputTokens: number;
    readonly latencyMs: {
      readonly p50: number;
      readonly p95: number;
    };
    readonly outputTokens: number;
    readonly retrievalSteps: number;
    readonly scannedResources: number;
    readonly toolCalls: number;
    readonly totalTokens: number;
  };
  readonly knowledgeSpaceId: string;
  readonly query: string;
  readonly retrievalPlan: ResearchTaskRetrievalPlan;
  readonly steps: readonly ResearchTaskDryRunStep[];
  readonly strategyVersion: "research-dry-run-planner-v1";
}

export interface ResearchTaskDryRunStep {
  readonly estimatedCostUsd: number;
  readonly estimatedInputTokens: number;
  readonly estimatedLatencyMs: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedToolCalls: number;
  readonly name: "analyze" | "generate" | "inspect" | "plan" | "retrieve";
}

export interface ResearchTaskDryRunPlanner {
  plan(input: ResearchTaskDryRunPlanInput): ResearchTaskDryRunPlan;
}

export interface ResearchTaskLimits {
  readonly maxRetrievalSteps?: number | undefined;
  readonly maxScannedResources?: number | undefined;
  readonly maxToolCalls?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface ResearchTaskLimitViolation {
  readonly estimatedValue: number;
  readonly limit: "maxRetrievalSteps" | "maxScannedResources" | "maxToolCalls" | "timeoutMs";
  readonly limitValue: number;
}

export interface ResearchTaskLimitEvaluation {
  readonly allowed: boolean;
  readonly violations: readonly ResearchTaskLimitViolation[];
}

const defaultMaxQueryBytes = 16_384;
// HTTP/MCP request schemas keep their own explicit-override ceilings. The dry-run planner must
// also accept an immutable space profile's Top K, whose persisted contract allows values to 100.
const defaultMaxTopK = 100;
const defaultLlmPricing: ResearchTaskLlmPricing = {
  inputPerTokenUsd: 0.000003,
  outputPerTokenUsd: 0.000012,
};

export function createResearchTaskDryRunPlanner({
  llmPricing = defaultLlmPricing,
  maxQueryBytes = defaultMaxQueryBytes,
  maxTopK = defaultMaxTopK,
  retrievalPlanner,
}: ResearchTaskDryRunPlannerOptions): ResearchTaskDryRunPlanner {
  if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("Research task dry-run maxQueryBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxTopK) || maxTopK < 1) {
    throw new Error("Research task dry-run maxTopK must be at least 1");
  }

  validateLlmPricing(llmPricing);

  return {
    plan(input) {
      const knowledgeSpaceId = input.knowledgeSpaceId.trim();
      const query = input.query.trim();
      const topK = input.topK ?? 10;

      if (!knowledgeSpaceId) {
        throw new Error("Research task dry-run knowledgeSpaceId is required");
      }

      if (!query) {
        throw new Error("Research task dry-run query is required");
      }

      if (new TextEncoder().encode(query).byteLength > maxQueryBytes) {
        throw new Error(`Research task dry-run query exceeds maxQueryBytes=${maxQueryBytes}`);
      }

      if (!Number.isSafeInteger(topK) || topK < 1) {
        throw new Error("Research task dry-run topK must be at least 1");
      }

      if (topK > maxTopK) {
        throw new Error(`Research task dry-run topK exceeds maxTopK=${maxTopK}`);
      }

      if (
        input.budgetUsd !== undefined &&
        (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0)
      ) {
        throw new Error("Research task dry-run budgetUsd must be a non-negative finite number");
      }

      const retrievalPlan = retrievalPlanner.plan({
        mode: input.mode ?? "research",
        query,
        ...(input.resolvedMode ? { resolvedMode: input.resolvedMode } : {}),
        topK,
        traceId: input.traceId,
      });
      const retrievalWork = estimateRetrievalWork(retrievalPlan);
      const steps = estimateSteps(query, retrievalPlan, retrievalWork, llmPricing);
      const inputTokens = steps.reduce((total, step) => total + step.estimatedInputTokens, 0);
      const outputTokens = steps.reduce((total, step) => total + step.estimatedOutputTokens, 0);
      const estimatedCost = roundCurrency(
        steps.reduce((total, step) => total + step.estimatedCostUsd, 0),
      );
      const toolCalls = steps.reduce((total, step) => total + step.estimatedToolCalls, 0);
      const p50Latency = steps.reduce((total, step) => total + step.estimatedLatencyMs, 0);
      const p95Latency = Math.ceil(p50Latency * 1.8);
      const budgetUsd = input.budgetUsd;

      return {
        budget: {
          ...(budgetUsd === undefined
            ? {}
            : {
                budgetUsd,
                remainingBudgetUsd: roundCurrency(budgetUsd - estimatedCost),
              }),
          exceedsBudget: budgetUsd !== undefined && estimatedCost > budgetUsd,
        },
        estimates: {
          cacheHitProbability: estimateCacheHitProbability(retrievalPlan),
          costUsd: {
            currency: "USD",
            estimated: estimatedCost,
            max: roundCurrency(estimatedCost * 1.35),
            min: roundCurrency(estimatedCost * 0.65),
          },
          inputTokens,
          latencyMs: {
            p50: p50Latency,
            p95: p95Latency,
          },
          outputTokens,
          retrievalSteps: retrievalWork.retrievalSteps,
          scannedResources: retrievalWork.scannedResources,
          toolCalls,
          totalTokens: inputTokens + outputTokens,
        },
        knowledgeSpaceId,
        query,
        retrievalPlan,
        steps,
        strategyVersion: "research-dry-run-planner-v1",
      };
    },
  };
}

export function evaluateResearchTaskLimits(
  plan: ResearchTaskDryRunPlan,
  limits: ResearchTaskLimits | undefined,
): ResearchTaskLimitEvaluation {
  const normalized = validateResearchTaskLimits(limits ?? {});
  const violations: ResearchTaskLimitViolation[] = [];

  addViolation(violations, "timeoutMs", plan.estimates.latencyMs.p95, normalized.timeoutMs);
  addViolation(
    violations,
    "maxRetrievalSteps",
    plan.estimates.retrievalSteps,
    normalized.maxRetrievalSteps,
  );
  addViolation(
    violations,
    "maxScannedResources",
    plan.estimates.scannedResources,
    normalized.maxScannedResources,
  );
  addViolation(violations, "maxToolCalls", plan.estimates.toolCalls, normalized.maxToolCalls);

  return {
    allowed: violations.length === 0,
    violations,
  };
}

function estimateSteps(
  query: string,
  retrievalPlan: ResearchTaskRetrievalPlan,
  retrievalWork: ResearchTaskRetrievalWorkEstimate,
  llmPricing: ResearchTaskLlmPricing,
): readonly ResearchTaskDryRunStep[] {
  const queryTokens = estimateTokens(query);
  const shouldInspectDocumentStructure = retrievalPlan.resolvedMode === "research";
  const analysisEvidenceItems = shouldInspectDocumentStructure
    ? retrievalPlan.topK
    : retrievalPlan.fusionLimit;

  return [
    {
      estimatedCostUsd: estimateLlmCost(queryTokens + 256, 192, llmPricing),
      estimatedInputTokens: queryTokens + 256,
      estimatedLatencyMs: 350,
      estimatedOutputTokens: 192,
      estimatedToolCalls: 1,
      name: "plan",
    },
    ...(shouldInspectDocumentStructure
      ? [
          {
            estimatedCostUsd: roundCurrency((queryTokens + 384) * llmPricing.inputPerTokenUsd),
            estimatedInputTokens: queryTokens + 384,
            estimatedLatencyMs: 180,
            estimatedOutputTokens: 0,
            // Published Research first scans Summary/Outline and traverses the PageIndex tree.
            estimatedToolCalls: retrievalWork.inspectToolCalls,
            name: "inspect" as const,
          },
        ]
      : []),
    {
      estimatedCostUsd: roundCurrency(retrievalWork.scannedResources * 0.000002),
      estimatedInputTokens: 0,
      estimatedLatencyMs: retrievalWork.retrievalLatencyMs,
      estimatedOutputTokens: 0,
      estimatedToolCalls: retrievalWork.retrieveToolCalls,
      name: "retrieve",
    },
    {
      estimatedCostUsd: estimateLlmCost(queryTokens + analysisEvidenceItems * 96, 384, llmPricing),
      estimatedInputTokens: queryTokens + analysisEvidenceItems * 96,
      estimatedLatencyMs: 650,
      estimatedOutputTokens: 384,
      estimatedToolCalls: 1,
      name: "analyze",
    },
    {
      estimatedCostUsd: estimateLlmCost(queryTokens + retrievalPlan.topK * 180, 1_200, llmPricing),
      estimatedInputTokens: queryTokens + retrievalPlan.topK * 180,
      estimatedLatencyMs: 1_200,
      estimatedOutputTokens: 1_200,
      estimatedToolCalls: 1,
      name: "generate",
    },
  ];
}

interface ResearchTaskRetrievalWorkEstimate {
  readonly inspectToolCalls: number;
  readonly retrievalLatencyMs: number;
  readonly retrievalSteps: number;
  readonly retrieveToolCalls: number;
  readonly scannedResources: number;
}

function estimateRetrievalWork(
  retrievalPlan: ResearchTaskRetrievalPlan,
): ResearchTaskRetrievalWorkEstimate {
  const baseHybridScans = retrievalPlan.denseTopK + retrievalPlan.ftsTopK;

  switch (retrievalPlan.resolvedMode) {
    case "fast":
      return {
        inspectToolCalls: 0,
        retrievalLatencyMs: 120 + retrievalPlan.fusionLimit * 2,
        retrievalSteps: 3,
        // Dense + FTS, followed by the single final rerank pass.
        retrieveToolCalls: 3,
        scannedResources: baseHybridScans,
      };
    case "research": {
      const pageIndexCandidateScan = Math.min(Math.max(retrievalPlan.topK * 4, 20), 100);
      return {
        // Summary/Outline scan + PageIndex tree traversal live in the existing inspect step.
        inspectToolCalls: 2,
        retrievalLatencyMs: 120 + pageIndexCandidateScan * 2 + retrievalPlan.topK * 4,
        // Summary/Outline scan, tree traversal, then bounded selected-leaf opens.
        retrievalSteps: 3,
        retrieveToolCalls: 1,
        // PageIndex section candidates plus selected leaf opens; no dense/FTS/rerank estimate.
        scannedResources: pageIndexCandidateScan + retrievalPlan.topK,
      };
    }
    case "deep":
      return {
        inspectToolCalls: 0,
        // Base hybrid, bounded graph traversal, and the graph-filtered second recall.
        retrievalLatencyMs: 240 + retrievalPlan.fusionLimit * 2 + 250,
        retrievalSteps: 4,
        // Base dense+FTS (2), graph traversal (1), second dense+FTS recall (2), rerank (1).
        retrieveToolCalls: 6,
        // Conservatively budget a second hybrid scan and bounded graph traversal candidates.
        scannedResources: baseHybridScans * 2 + retrievalPlan.fusionLimit,
      };
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).byteLength / 4));
}

function estimateLlmCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ResearchTaskLlmPricing,
): number {
  return roundCurrency(
    inputTokens * pricing.inputPerTokenUsd + outputTokens * pricing.outputPerTokenUsd,
  );
}

function estimateCacheHitProbability(plan: ResearchTaskRetrievalPlan): number {
  const base = plan.resolvedMode === "fast" ? 0.5 : plan.resolvedMode === "deep" ? 0.35 : 0.25;
  const languagePenalty = plan.queryLanguage === "mixed-cjk-latin" ? 0.05 : 0;
  return roundProbability(base - languagePenalty);
}

function validateResearchTaskLimits(limits: ResearchTaskLimits): ResearchTaskLimits {
  for (const [key, value] of Object.entries(limits) as Array<
    [keyof ResearchTaskLimits, number | undefined]
  >) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`Research task limit ${key} must be at least 1`);
    }
  }

  return limits;
}

function validateLlmPricing(pricing: ResearchTaskLlmPricing): void {
  for (const [key, value] of Object.entries(pricing) as Array<
    [keyof ResearchTaskLlmPricing, number]
  >) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Research task dry-run ${key} must be a non-negative finite number`);
    }
  }
}

function addViolation(
  violations: ResearchTaskLimitViolation[],
  limit: ResearchTaskLimitViolation["limit"],
  estimatedValue: number,
  limitValue: number | undefined,
): void {
  if (limitValue !== undefined && estimatedValue > limitValue) {
    violations.push({ estimatedValue, limit, limitValue });
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundProbability(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}
