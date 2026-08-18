# Research Evidence Retrieval V3

Date: 2026-08-18

## Objective

Replace online per-document LLM tree traversal with a knowledge-space-wide evidence pipeline whose
model-call count is bounded independently of the number and depth of published document outlines.
The existing immutable publication, outline, dense/FTS projections, graph provenance, rerank model,
ACL filters, citations, and durable Research task APIs remain the source of truth.

The online pipeline is:

1. classify the query locally and invoke the reasoning planner only for complex queries;
2. batch-embed at most three planned queries;
3. run published Dense, FTS, Graph, and Outline recall with filters and ACLs pushed down;
4. combine incomparable recall ranks with weighted reciprocal-rank fusion;
5. open a bounded number of immutable outline ranges and add parent/section context;
6. run the configured rerank model once over the merged evidence candidates;
7. judge evidence coverage as one set and, when necessary, execute at most one supplemental round;
8. return evidence with separate relevance, coverage, and retrieval provenance.

The reasoning model never scores every candidate and never walks one outline level at a time.

## Measured baseline

The baseline is the two production-like Research tasks for query `问责方式` in control space
`019fac9f-bfb0-75ee-9af5-252ebafbac1c` on 2026-08-18:

- 13 published documents and 427 outline nodes;
- 150.236-150.888 seconds until terminal failure;
- five execution attempts per task;
- five query-embedding requests and ten reasoning-model PageIndex calls;
- ten unreconciled model reservations for the latest task, estimated at USD 0.21618;
- every provider call returned in approximately 2.1-12.5 seconds; the remaining delay was lease
  expiry after a concurrent row-version fence failure.

These numbers are a failure baseline, not a performance claim. Final improvement percentages must
be computed from the same query/corpus after deployment.

## Iteration plan

### I1 - Durable correctness and observability

- Make every serialized Research mutation update the in-memory fenced job inside the same lane.
- Ensure heartbeat, stage, checkpoint, cost reservation/reconciliation, completion, failure, and
  retry release all consume the latest row version.
- Reconcile a lost retry fence once from durable storage, without mutating a lease owned elsewhere.
- Wire structured runtime errors in production and retain the first actionable failure class.
- Add concurrent model-accounting plus heartbeat/retry regression tests.

Acceptance: concurrent model calls reconcile exactly once, no reservation remains `reserved`, a
failed attempt is released immediately, and the same task is not reclaimed while its heartbeat is
healthy.

### I2 - Query plan and fixed budgets

- Add a strict, versioned query-plan contract: intent, at most three subqueries, Graph requirement,
  and evidence dimensions.
- Skip the planning model for direct factual/exact lookup queries.
- Batch all planned query embeddings in one provider request.
- Set soft budgets for documents, candidates, outline ranges, Graph depth, model calls, and rounds;
  retain hard safety bounds in the durable policy.

Acceptance: simple queries use zero planning calls; complex queries use exactly one; planned query
count and byte/token bounds are enforced before any provider call.

### I3 - Multi-channel published recall

- Enable Research Dense and FTS recall instead of Dense-only document selection.
- Run published Graph expansion only when the plan requests relationship evidence.
- Use embedded outline/summary nodes from Dense recall and exact PageIndex section postings for
  deterministic outline navigation.
- Apply metadata, ACL, and immutable publication membership at every read boundary.

Acceptance: Research retrieves from Dense, FTS, Graph, and Outline without any tree-navigation LLM
call; missing Graph/Outline capabilities degrade explicitly while authorization and snapshot
failures remain fail-closed.

### I4 - Evidence expansion and RRF

- Select documents from fused candidate ranks, not raw cross-channel scores.
- Map candidate nodes to the deepest matching outline section and open only bounded ranges.
- Add parent path and neighboring evidence context without exposing unrelated descendants.
- Deduplicate overlapping ranges and content-equivalent evidence.
- Use weighted reciprocal-rank fusion for recall ordering; keep raw channel scores internal.

Acceptance: candidate order is deterministic, one document cannot dominate through duplicate
projections, and every expanded item resolves to a concrete published node/citation.

### I5 - One final rerank and explainable scores

- Apply the knowledge-space rerank model once after all recall/Graph/Outline candidates are merged.
- Expose rerank score as `relevanceScore`/final item score in `[0, 1]`.
- Keep retrieval/RRF rank and channel provenance as diagnostics, not a user similarity score.
- Apply score threshold after rerank and before final Top K.

Acceptance: one rerank request per round, no LLM item scoring, strict model identity and score-domain
validation, and stable threshold semantics across Fast, Deep, and Research.

### I6 - Evidence sufficiency and one supplemental round

- Judge all top evidence in one structured reasoning call.
- Return covered/missing evidence dimensions and one bounded supplemental query when necessary.
- Permit at most one supplemental retrieval round; reuse the same publication/profile snapshot.
- Re-rank the combined set once and stop regardless of the second-round result.

Acceptance: ordinary answerable queries stop after the first round; supplemental work is bounded and
observable; retrieval miss, coverage gap, and irrelevant query remain distinct outcomes.

### I7 - Durable replay, regression, and measured report

- Persist versioned `planned`, `initial` (recall + rerank), `supplemental` (judged), and `complete`
  boundaries.
- Resume only the failed stage and never repeat a completed model call with the same idempotency key.
- Update dry-run estimates, operational metrics, API/operator documentation, and compatibility tests.
- Run typecheck, Biome, API tests, retrieval regression, contract checks, and a same-corpus benchmark.

Report p50/p95 latency, attempts, model calls, token usage, candidate counts, Recall@K, citation hit
rate, no-answer rate, and exact cost observations. Do not publish an improvement percentage unless
both baseline and post-change samples are measured under the same corpus, query set, and models.

## Rollout and compatibility

- The public Research request/response and durable task resources stay compatible.
- Existing V2 checkpoints remain readable for in-flight tasks; new tasks write V3 stage metadata.
- PageIndex tree-search implementations remain available for offline findability evaluation and
  historical checkpoint replay, but are removed from the online V3 main path.
- Fast and Deep behavior changes only where score semantics are intentionally unified through the
  already-required rerank capability.
- V2 is not a silent fallback for fresh requests; it is selected only by an authenticated retained
  V2 checkpoint. A V3 dependency or integrity failure remains visible and fail-closed.
