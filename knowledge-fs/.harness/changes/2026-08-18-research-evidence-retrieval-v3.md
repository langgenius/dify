# Research Evidence Retrieval V3

Date: 2026-08-18

## What changed

- Replaced fresh online Research requests' per-document PageIndex LLM traversal with a bounded
  knowledge-space evidence orchestrator.
- Direct queries skip model planning. Complex queries use one structured planner call and at most
  three batch-embedded rewrites.
- Research now recalls from published dense, FTS, deterministic outline ranges, and an optional
  single Graph leg, then combines ranked lists with weighted reciprocal-rank fusion.
- The knowledge-space rerank model now owns Research's final comparable score. One structured
  reasoning call judges the evidence set; durable execution may perform one focused supplemental
  recall and rerank.
- Added V3 `planned`, `initial`, `supplemental`, and `complete` replay boundaries. Retained V2
  checkpoints still resume through the compatibility PageIndex traversal.
- Serialized durable job mutations now advance one in-memory row version inside the same mutation
  lane, preventing concurrent model accounting from losing the execution lease.

## Why

The V2 online path scaled reasoning calls with the number and depth of shortlisted document trees.
It also excluded FTS and the configured reranker even though those published capabilities already
existed. A concurrent row-version race could turn otherwise successful provider calls into repeated
lease-expiry attempts. V3 makes model work independent of corpus document count, unifies score
semantics with the required reranker, and preserves successful stages across durable retries.

## Compatibility

- Public query, Retrieval Test, workflow, and durable task request shapes are unchanged.
- Fresh requests always use V3 when the production capability is assembled.
- An authenticated retained `research-retrieval-checkpoint-v2` is the only path into V2; V3 does
  not silently fall back on dependency or integrity failures.
- Fast and Deep retain their existing execution paths.

## Verification

- Focused API tests cover planner budgets, weighted RRF, query vectorization, deterministic outline
  expansion, V3 orchestration, all replay boundaries, V2 checkpoint compatibility, Retrieval Test,
  FTS readiness, and concurrent durable model accounting.
- API-app wiring tests prove fresh Research invokes FTS and the profile reranker while the legacy
  PageIndex LLM scorer remains unused.
- `@knowledge/api`: 4,588 passed, 3 skipped; typecheck passed.
- `@knowledge/api-app`: 258 passed; typecheck passed.
- Focused V3 core coverage: statements/lines 96.70%, branches 88.46%, functions 97.50%.
- Backend Biome gate: 1,071 files checked with no diagnostics.
- Retrieval regression gate: Recall@K 0.890, citation hit rate 0.880, no-answer rate 0.060,
  citation accuracy 0.890, faithfulness 0.910.
- Phase 4 evaluation: 10 questions; enriched/summary-tree/Graph recall deltas remained
  0.050/0.070/0.090.
- OpenAPI and Capability v2 deterministic export tests passed.

## Performance reporting

The implementation records candidate-list count, RRF candidates, plan time, evidence-judge time,
rerank time, model calls, rounds, and supplemental searches. Fresh retrieval has a hard maximum of
two reasoning calls (planner and judge); direct queries skip the planner. No wall-clock improvement
percentage is claimed until the same query corpus and model configuration are benchmarked after
deployment.

The enforceable model-call cap changed from 10 to 2 for interactive Research (80% lower) and from
40 to 2 for durable Research (95% lower). The dry-run planner's expected durable model work,
including final answer synthesis, changed from 17 calls under V2 to 3 under V3 (82.35% lower), and
estimated tool calls changed from 22 to 6 (72.73% lower). These are contract-level bounds and plan
estimates, not measured latency or cost improvements.
