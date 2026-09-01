/**
 * Ceiling for the initial multi-intent cross-encoder pool and durable Research evidence bundles.
 *
 * Keeping the two limits identical is intentional: a replay-safe boundary must retain every
 * candidate that can still affect the final supplemental merge. One durable supplemental list is
 * additionally bounded by the retrieval plan. Raising this limit therefore requires reviewing
 * both provider cost and checkpoint payload size.
 */
export const RESEARCH_MAX_RERANK_CANDIDATES = 200;
