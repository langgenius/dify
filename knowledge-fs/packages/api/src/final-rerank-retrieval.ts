import {
  type KnowledgeSpaceModelSelection,
  assertKnowledgeSpaceRetrievalProfileForMode,
} from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";

import { type RetrievalPlanner, defaultRetrievalPlan } from "./retrieval-planner";
import { rerankHybridRetrievalItems } from "./retrieval-rerank";
import type {
  BasicHybridRetriever,
  HybridRetrievalResult,
  RetrievalPlan,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface FinalRerankRetrievalOptions {
  readonly maxRerankCandidates?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly planner?: RetrievalPlanner | undefined;
  /**
   * Optional deployment default used only by legacy requests that do not carry
   * a knowledge-space retrieval profile.
   */
  readonly reranker?: RerankerProvider | undefined;
  readonly rerankerFactory?:
    | ((selection: KnowledgeSpaceModelSelection) => RerankerProvider)
    | undefined;
  /** Model paired with `reranker`; omitted when no legacy default is configured. */
  readonly rerankerModel?: string | undefined;
  readonly retriever: BasicHybridRetriever;
}

/**
 * Applies one final rerank after every mode-specific retrieval extension has
 * composed its candidates. Fast and deep use reranking; research intentionally
 * returns its PageIndex/outline result without reranking.
 */
export function createFinalRerankRetrieval({
  maxRerankCandidates = 200,
  now = Date.now,
  planner,
  reranker,
  rerankerFactory,
  rerankerModel,
  retriever,
}: FinalRerankRetrievalOptions): BasicHybridRetriever {
  if (reranker && !rerankerModel?.trim()) {
    throw new Error("Final retrieval rerankerModel is required when reranker is configured");
  }

  if (rerankerModel?.trim() && !reranker) {
    throw new Error("Final retrieval reranker is required when rerankerModel is configured");
  }

  if (!Number.isInteger(maxRerankCandidates) || maxRerankCandidates < 1) {
    throw new Error("Final retrieval maxRerankCandidates must be at least 1");
  }

  return {
    retrieve: async (input) => {
      // The explicit research contract never reranks. Avoid widening its
      // structural retrieval merely to discover the same decision later.
      if (input.mode === "research") {
        if (input.retrievalProfile) {
          assertKnowledgeSpaceRetrievalProfileForMode(input.retrievalProfile, "research");
        }
        return retriever.retrieve(input);
      }

      const planned = resolveFinalRerankPlan(input, planner);
      if (input.retrievalProfile) {
        assertKnowledgeSpaceRetrievalProfileForMode(input.retrievalProfile, planned.resolvedMode);
      }
      if (!shouldFinalRerank(planned)) {
        return retriever.retrieve(input);
      }

      // Resolve a knowledge-space provider only after the plan has confirmed
      // that this request will rerank. This keeps the Research pipeline and
      // profiles with reranking disabled from instantiating or calling a
      // provider that cannot affect the result.
      const runtime = resolveFinalRerankRuntime({
        input,
        reranker,
        rerankerFactory,
        rerankerModel,
      });
      if (!runtime) {
        return retriever.retrieve(input);
      }

      const candidateLimit = Math.min(
        Math.max(input.limit, planned.rerankCandidateLimit),
        maxRerankCandidates,
      );
      const retrieval = await retriever.retrieve({ ...input, limit: candidateLimit });
      const effectivePlan = retrieval.plan ?? planned;

      // A custom/stateful planner could still return a different concrete plan on the inner
      // call. Preserve the Research contract and restore the requested limit.
      if (!shouldFinalRerank(effectivePlan)) {
        return limitRetrievalResult(retrieval, input.limit);
      }

      const rerankStartedAt = now();
      const rerankedItems = await rerankHybridRetrievalItems({
        items: retrieval.items,
        limit: retrieval.items.length,
        model: runtime.model,
        query: input.query,
        reranker: runtime.provider,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      });
      const rerankMs = Math.max(0, now() - rerankStartedAt);
      const scoreThreshold = runtime.scoreThreshold;
      const thresholdedItems =
        scoreThreshold === undefined
          ? rerankedItems
          : rerankedItems.filter((item) => item.score >= scoreThreshold);
      const scoreThresholdFilteredCandidates = rerankedItems.length - thresholdedItems.length;
      const items = thresholdedItems.slice(0, input.limit);

      return {
        items,
        ...(retrieval.metrics
          ? {
              metrics: {
                ...retrieval.metrics,
                rerankCandidates: retrieval.items.length,
                rerankMs,
                ...(scoreThreshold === undefined ? {} : { scoreThresholdFilteredCandidates }),
                totalMs: retrieval.metrics.totalMs + rerankMs,
              },
            }
          : {}),
        plan: effectivePlan,
      };
    },
  };
}

function resolveFinalRerankRuntime({
  input,
  reranker,
  rerankerFactory,
  rerankerModel,
}: {
  readonly input: RetrieveHybridInput;
  readonly reranker: RerankerProvider | undefined;
  readonly rerankerFactory:
    | ((selection: KnowledgeSpaceModelSelection) => RerankerProvider)
    | undefined;
  readonly rerankerModel: string | undefined;
}):
  | {
      readonly model: string;
      readonly provider: RerankerProvider;
      readonly scoreThreshold?: number | undefined;
    }
  | undefined {
  const profile = input.retrievalProfile;
  if (!profile) {
    return reranker && rerankerModel ? { model: rerankerModel, provider: reranker } : undefined;
  }

  if (!profile.rerank.enabled) {
    return undefined;
  }

  const selection = profile.rerank.model;
  if (!selection) {
    throw new Error("Enabled knowledge-space rerank profile is missing its model selection");
  }
  if (!rerankerFactory) {
    throw new Error(
      "Knowledge-space rerank is enabled, but the reranker capability is unavailable",
    );
  }

  return {
    model: selection.model,
    provider: rerankerFactory(selection),
    ...(profile.scoreThreshold.enabled && profile.scoreThreshold.value !== undefined
      ? { scoreThreshold: profile.scoreThreshold.value }
      : {}),
  };
}

function resolveFinalRerankPlan(
  input: RetrieveHybridInput,
  planner: RetrievalPlanner | undefined,
): RetrievalPlan {
  return (
    planner?.plan({
      mode: input.mode,
      query: input.query,
      topK: input.topK,
      traceId: input.traceId,
    }) ?? defaultRetrievalPlan({ query: input.query, topK: input.topK })
  );
}

function shouldFinalRerank(plan: RetrievalPlan): boolean {
  return plan.resolvedMode !== "research" && plan.rerankCandidateLimit > 0;
}

function limitRetrievalResult(
  retrieval: HybridRetrievalResult,
  limit: number,
): HybridRetrievalResult {
  return {
    ...retrieval,
    items: retrieval.items.slice(0, limit),
  };
}
