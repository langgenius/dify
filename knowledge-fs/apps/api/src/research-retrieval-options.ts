import { RESEARCH_MAX_RERANK_CANDIDATES } from "@knowledge/api";

import { positiveIntegerEnv } from "./generation-provider";

export interface ApiResearchRetrievalEnv {
  readonly KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES?: string | undefined;
}

export interface ApiResearchRetrievalOptions {
  readonly maxRerankCandidates: number;
}

/**
 * Bounds the initial cross-encoder pool shared by the original query and all planned intents.
 * Operators may lower it to trade recall depth for latency. A durable policy may run one
 * additional, independently plan-bounded supplemental list after the evidence judge; that work is
 * separately exposed in the per-list metrics instead of being hidden in this initial pool.
 */
export function createApiResearchRetrievalOptions(
  env: ApiResearchRetrievalEnv = process.env,
): ApiResearchRetrievalOptions {
  const maxRerankCandidates = positiveIntegerEnv(
    env.KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES,
    RESEARCH_MAX_RERANK_CANDIDATES,
    "KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES",
  );
  if (maxRerankCandidates > RESEARCH_MAX_RERANK_CANDIDATES) {
    throw new Error(
      `KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES must not exceed ${RESEARCH_MAX_RERANK_CANDIDATES}`,
    );
  }
  return { maxRerankCandidates };
}
