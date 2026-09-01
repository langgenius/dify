import { getTraceErrorClass } from "./http-tracing";
import { type RetrievalQueryLanguage, detectRetrievalQueryLanguage } from "./retrieval-text-utils";
import type { RetrievalMode, RetrievalPlan } from "./retrieval-types";
import { type TraceAttributes, type TraceRecorder, createNoopTraceRecorder } from "./tracing";

/** One shared ceiling for production planning and the retrieval-test contract. */
export const RETRIEVAL_MAX_TOP_K = 100;

export interface RetrievalPlanInput {
  readonly hasQueryImages?: boolean | undefined;
  readonly mode?: RetrievalMode | undefined;
  readonly query: string;
  /** Required when `mode=auto`; auto must be resolved by the asynchronous LLM router first. */
  readonly resolvedMode?: Exclude<RetrievalMode, "auto"> | undefined;
  readonly topK: number;
  readonly traceId?: string | undefined;
}

export interface RetrievalPlanner {
  plan(input: RetrievalPlanInput): RetrievalPlan;
}

export interface RetrievalPlannerOptions {
  readonly maxTopK: number;
  readonly traces?: TraceRecorder | undefined;
}

export function createRetrievalPlanner({
  maxTopK,
  traces = createNoopTraceRecorder(),
}: RetrievalPlannerOptions): RetrievalPlanner {
  if (!Number.isInteger(maxTopK) || maxTopK < 1) {
    throw new Error("Retrieval planner maxTopK must be at least 1");
  }

  return {
    plan(input) {
      const requestedMode = input.mode ?? "fast";
      const topK = input.topK;
      const span = traces.startSpan("retrieval.plan", {
        requestedMode,
        topK,
        ...(input.traceId ? { traceId: input.traceId } : {}),
      });

      try {
        if (!Number.isInteger(topK) || topK < 1) {
          throw new Error("Retrieval planner topK must be at least 1");
        }

        if (topK > maxTopK) {
          throw new Error(`Retrieval planner topK exceeds maxTopK=${maxTopK}`);
        }

        const normalizedQuery = input.query.trim();
        if (normalizedQuery.length === 0 && !input.hasQueryImages) {
          throw new Error(
            input.hasQueryImages === undefined
              ? "Retrieval planner query must not be empty"
              : "Retrieval planner query or query images must be provided",
          );
        }

        const queryLanguage = normalizedQuery
          ? detectRetrievalQueryLanguage(normalizedQuery)
          : "other";
        const resolvedMode = resolvePlannedMode(requestedMode, input.resolvedMode);
        const plan = buildRetrievalPlan({
          maxTopK,
          queryLanguage,
          requestedMode,
          resolvedMode,
          topK,
        });

        span.end("ok", retrievalPlanTraceAttributes(plan));
        return plan;
      } catch (error) {
        span.end("error", { errorClass: getTraceErrorClass(error) });
        throw error;
      }
    },
  };
}

export function defaultRetrievalPlan({
  hasQueryImages = false,
  query,
  topK,
}: {
  readonly hasQueryImages?: boolean | undefined;
  readonly query: string;
  readonly topK: number;
}): RetrievalPlan {
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error("Retrieval planner topK must be at least 1");
  }

  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0 && !hasQueryImages) {
    throw new Error("Retrieval planner query must not be empty");
  }

  return buildRetrievalPlan({
    maxTopK: topK,
    queryLanguage: normalizedQuery ? detectRetrievalQueryLanguage(normalizedQuery) : "other",
    requestedMode: "fast",
    resolvedMode: "fast",
    topK,
  });
}

function resolvePlannedMode(
  requestedMode: RetrievalMode,
  resolvedMode: Exclude<RetrievalMode, "auto"> | undefined,
): Exclude<RetrievalMode, "auto"> {
  if (requestedMode === "auto") {
    if (!resolvedMode) {
      throw new Error("Retrieval planner auto mode requires an LLM-resolved mode");
    }
    return resolvedMode;
  }
  if (resolvedMode && resolvedMode !== requestedMode) {
    throw new Error("Retrieval planner resolved mode must match an explicit requested mode");
  }
  return requestedMode;
}

function buildRetrievalPlan({
  maxTopK,
  queryLanguage,
  requestedMode,
  resolvedMode,
  topK,
}: {
  readonly maxTopK: number;
  readonly queryLanguage: RetrievalQueryLanguage;
  readonly requestedMode: RetrievalMode;
  readonly resolvedMode: Exclude<RetrievalMode, "auto">;
  readonly topK: number;
}): RetrievalPlan {
  const multipliers = retrievalModeMultipliers(resolvedMode);
  const denseTopK = boundedRetrievalFanout(topK, multipliers.recall, maxTopK);
  const ftsTopK = boundedRetrievalFanout(topK, multipliers.recall, maxTopK);
  const fusionLimit = boundedRetrievalFanout(topK, multipliers.fusion, maxTopK);

  return {
    denseTopK,
    ftsTopK,
    fusionLimit,
    queryLanguage,
    requestedMode,
    // Every online mode ends in the same profile-scoped reranker score domain. Research divides
    // this bounded candidate budget across its query intents before merging raw reranker scores.
    rerankCandidateLimit: fusionLimit,
    resolvedMode,
    strategyVersion: resolvedMode === "research" ? "retrieval-planner-v2" : "retrieval-planner-v1",
    topK,
  };
}

function retrievalModeMultipliers(mode: Exclude<RetrievalMode, "auto">): {
  readonly fusion: number;
  readonly recall: number;
} {
  switch (mode) {
    case "fast":
      return { fusion: 1, recall: 1 };
    case "deep":
      return { fusion: 3, recall: 5 };
    case "research":
      return { fusion: 5, recall: 10 };
  }
}

function boundedRetrievalFanout(topK: number, multiplier: number, maxTopK: number): number {
  return Math.min(topK * multiplier, maxTopK);
}

function retrievalPlanTraceAttributes(plan: RetrievalPlan): TraceAttributes {
  return {
    denseTopK: plan.denseTopK,
    ftsTopK: plan.ftsTopK,
    fusionLimit: plan.fusionLimit,
    queryLanguage: plan.queryLanguage,
    requestedMode: plan.requestedMode,
    rerankCandidateLimit: plan.rerankCandidateLimit,
    resolvedMode: plan.resolvedMode,
    topK: plan.topK,
  };
}
