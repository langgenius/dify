import type { QueryImageReference } from "./query-images";

export type ResearchTaskPlanMode = "auto" | "deep" | "fast" | "research";
export type ResearchTaskResolvedMode = Exclude<ResearchTaskPlanMode, "auto">;
export type ResearchTaskQueryLanguage = "cjk" | "latin" | "mixed-cjk-latin" | "other";

export interface ResearchTaskRetrievalPlanInput {
  readonly hasQueryImages?: boolean | undefined;
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
  readonly researchPolicy?: ResearchRetrievalExecutionPolicy | undefined;
}

export interface ResearchTaskLlmPricing {
  readonly inputPerTokenUsd: number;
  readonly outputPerTokenUsd: number;
}

export interface ResearchTaskDryRunPlanInput {
  readonly budgetUsd?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode?: ResearchTaskPlanMode | undefined;
  readonly query?: string | undefined;
  readonly queryImageCount?: number | undefined;
  readonly queryImages?: readonly QueryImageReference[] | undefined;
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
    readonly workBounds?:
      | {
          readonly modelCalls: ResearchTaskEstimateBound;
          readonly openedResources: ResearchTaskEstimateBound;
          readonly retrievalSteps: ResearchTaskEstimateBound;
        }
      | undefined;
  };
  readonly knowledgeSpaceId: string;
  readonly query: string;
  readonly queryImages?: readonly QueryImageReference[] | undefined;
  readonly retrievalPlan: ResearchTaskRetrievalPlan;
  readonly steps: readonly ResearchTaskDryRunStep[];
  readonly strategyVersion: "research-dry-run-planner-v1";
}

export interface ResearchTaskEstimateBound {
  readonly estimated: number;
  readonly max: number;
  readonly min: number;
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
export const DefaultResearchTaskLlmPricing: ResearchTaskLlmPricing = Object.freeze({
  inputPerTokenUsd: 0.000003,
  outputPerTokenUsd: 0.000012,
});

export function createResearchTaskDryRunPlanner({
  llmPricing = DefaultResearchTaskLlmPricing,
  maxQueryBytes = defaultMaxQueryBytes,
  maxTopK = defaultMaxTopK,
  researchPolicy = DurableResearchEvidenceRetrievalPolicy,
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
      const query = input.query?.trim() ?? "";
      const queryImages = input.queryImages ?? [];
      const queryImageCount = input.queryImageCount ?? queryImages.length;
      const topK = input.topK ?? 10;

      if (!knowledgeSpaceId) {
        throw new Error("Research task dry-run knowledgeSpaceId is required");
      }

      if (!query && queryImageCount === 0) {
        throw new Error(
          input.queryImages === undefined && input.queryImageCount === undefined
            ? "Research task dry-run query is required"
            : "Research task dry-run requires query or queryImages",
        );
      }

      if (!Number.isSafeInteger(queryImageCount) || queryImageCount < 0 || queryImageCount > 4) {
        throw new Error("Research task dry-run queryImageCount must be between 0 and 4");
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
        hasQueryImages: queryImageCount > 0,
        query,
        ...(input.resolvedMode ? { resolvedMode: input.resolvedMode } : {}),
        topK,
        traceId: input.traceId,
      });
      const retrievalWork = estimateRetrievalWork(retrievalPlan, researchPolicy);
      const steps = estimateSteps(query, queryImageCount, retrievalPlan, retrievalWork, llmPricing);
      const inputTokens = steps.reduce((total, step) => total + step.estimatedInputTokens, 0);
      const outputTokens = steps.reduce((total, step) => total + step.estimatedOutputTokens, 0);
      const estimatedCost = roundCurrency(
        steps.reduce((total, step) => total + step.estimatedCostUsd, 0),
      );
      const toolCalls = steps.reduce((total, step) => total + step.estimatedToolCalls, 0);
      const p50Latency = steps.reduce((total, step) => total + step.estimatedLatencyMs, 0);
      const p95Latency = Math.ceil(p50Latency * 1.8);
      const budgetUsd = input.budgetUsd;
      const imageExpansionCalls =
        queryImageCount > 0 && retrievalPlan.resolvedMode !== "fast" ? 1 : 0;

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
          workBounds: addEstimatedModelCalls(retrievalWork.workBounds, imageExpansionCalls),
        },
        knowledgeSpaceId,
        query,
        ...(queryImages.length > 0 ? { queryImages } : {}),
        retrievalPlan,
        steps,
        strategyVersion: "research-dry-run-planner-v1",
      };
    },
  };
}

function addEstimatedModelCalls(
  bounds: ResearchTaskRetrievalWorkEstimate["workBounds"],
  calls: number,
): ResearchTaskRetrievalWorkEstimate["workBounds"] {
  if (calls === 0) return bounds;
  return {
    ...bounds,
    modelCalls: {
      estimated: bounds.modelCalls.estimated + calls,
      max: bounds.modelCalls.max + calls,
      min: bounds.modelCalls.min + calls,
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
  queryImageCount: number,
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
    ...(queryImageCount > 0 && retrievalPlan.resolvedMode !== "fast"
      ? [
          {
            estimatedCostUsd: estimateLlmCost(
              queryTokens + queryImageCount * 1_024,
              512,
              llmPricing,
            ),
            estimatedInputTokens: queryTokens + queryImageCount * 1_024,
            estimatedLatencyMs: 800,
            estimatedOutputTokens: 512,
            estimatedToolCalls: 1,
            name: "analyze" as const,
          },
        ]
      : []),
    {
      estimatedCostUsd: estimateLlmCost(queryTokens + 256, 192, llmPricing),
      estimatedInputTokens: queryTokens + 256,
      estimatedLatencyMs: 350,
      estimatedOutputTokens: 192,
      estimatedToolCalls: 1,
      name: "plan",
    },
    ...(shouldInspectDocumentStructure && retrievalWork.inspectToolCalls > 0
      ? [
          {
            estimatedCostUsd: estimateLlmCost(
              (queryTokens + 384) * retrievalWork.inspectToolCalls,
              128 * retrievalWork.inspectToolCalls,
              llmPricing,
            ),
            estimatedInputTokens: (queryTokens + 384) * retrievalWork.inspectToolCalls,
            estimatedLatencyMs: 350 * retrievalWork.inspectToolCalls,
            estimatedOutputTokens: 128 * retrievalWork.inspectToolCalls,
            // Root-to-leaf layered selections plus a bounded compatibility/fallback allowance.
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
  readonly workBounds: {
    readonly modelCalls: ResearchTaskEstimateBound;
    readonly openedResources: ResearchTaskEstimateBound;
    readonly retrievalSteps: ResearchTaskEstimateBound;
  };
}

function estimateRetrievalWork(
  retrievalPlan: ResearchTaskRetrievalPlan,
  researchPolicy: ResearchRetrievalExecutionPolicy,
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
        workBounds: fixedWorkBounds({
          modelCalls: 3,
          openedResources: baseHybridScans,
          retrievalSteps: 3,
        }),
      };
    case "research": {
      const policyWork = estimateResearchRetrievalWork(researchPolicy, {
        includeFinalSynthesis: true,
      });
      const legacyInspectionModelCalls =
        researchPolicy.strategyVersion === "pageindex-v2"
          ? Math.max(0, policyWork.expected.modelCalls - 1)
          : 0;
      const estimatedRecallLists = Math.min(4, policyWork.expected.retrievalSteps);
      return {
        inspectToolCalls: legacyInspectionModelCalls,
        retrievalLatencyMs:
          120 +
          baseHybridScans * 2 +
          policyWork.expected.openedResources * 4 +
          legacyInspectionModelCalls * 350,
        retrievalSteps: policyWork.expected.retrievalSteps,
        retrieveToolCalls: policyWork.expected.retrievalSteps,
        scannedResources:
          baseHybridScans * estimatedRecallLists + policyWork.expected.openedResources,
        workBounds: {
          modelCalls: estimateBound(
            policyWork.minimum.modelCalls,
            policyWork.expected.modelCalls,
            policyWork.maximum.modelCalls,
          ),
          openedResources: estimateBound(
            policyWork.minimum.openedResources,
            policyWork.expected.openedResources,
            policyWork.maximum.openedResources,
          ),
          retrievalSteps: estimateBound(
            policyWork.minimum.retrievalSteps,
            policyWork.expected.retrievalSteps,
            policyWork.maximum.retrievalSteps,
          ),
        },
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
        workBounds: fixedWorkBounds({
          modelCalls: 3,
          openedResources: baseHybridScans * 2 + retrievalPlan.fusionLimit,
          retrievalSteps: 4,
        }),
      };
  }
}

function estimateBound(min: number, estimated: number, max: number): ResearchTaskEstimateBound {
  return { estimated, max, min };
}

function fixedWorkBounds(input: {
  readonly modelCalls: number;
  readonly openedResources: number;
  readonly retrievalSteps: number;
}): ResearchTaskRetrievalWorkEstimate["workBounds"] {
  return {
    modelCalls: estimateBound(input.modelCalls, input.modelCalls, input.modelCalls),
    openedResources: estimateBound(
      input.openedResources,
      input.openedResources,
      input.openedResources,
    ),
    retrievalSteps: estimateBound(input.retrievalSteps, input.retrievalSteps, input.retrievalSteps),
  };
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
import {
  DurableResearchEvidenceRetrievalPolicy,
  type ResearchRetrievalExecutionPolicy,
  estimateResearchRetrievalWork,
} from "./research-retrieval-policy";
