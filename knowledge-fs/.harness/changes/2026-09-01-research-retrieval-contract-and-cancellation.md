# Research Retrieval Contract and Cancellation

## Problem

The retrieval-test HTTP contract could not serialize a successful Research Evidence V3 result:
the route only allowed planner v1 and its strict metrics DTO rejected every Research metric. The
handler converted either schema error into `RETRIEVAL_TEST_UNAVAILABLE` (503). In addition, the
retrieval execution lease signal stopped at the first query embedding, so a lost lease or an HTTP
disconnect could leave planning, rewritten-query embeddings, parallel recall, PageIndex opens and
reranking running until their individual timeouts.

Research also had several bounded-quality and observability inconsistencies: interactive requests
paid for a judge whose supplemental result could never execute, the outline-open budget was not
consumed, a small RRF window could discard already-reranked evidence, durable checkpoints omitted
the candidate tail needed by a supplemental replay, parallel timings were summed as if sequential,
and the generic final wrapper replaced the Research tie order.

## Changes

- Accepted planner v1/v2 in the retrieval-test response, projected every current Research/PageIndex
  metric, and stripped unknown internal telemetry at the public DTO boundary. Future operational
  metrics can therefore evolve without turning a successful retrieval into a 503. A handler test
  now serializes the Research executor's v2/result shape through the real HTTP response schema.
- Combined the request disconnect and durable retrieval-lease signals. The signal now reaches query
  and rewritten-query embeddings, planner/judge providers, all recall paths, graph traversal,
  outline listing/search/opening, visual embedding/search, and cross-encoder reranking. A shared
  abort race stops awaiting older database/adaptor implementations that cannot physically cancel,
  while providers that accept a signal receive it directly.
- Added a hard request-wide Research wall-clock signal in addition to counter snapshots and
  per-provider timeouts. Budget consumption observes cancellation, queued concurrency gates remove
  canceled work, and active fanout stops scheduling/awaiting work after ownership is lost.
- Skipped the evidence judge when the active interactive policy cannot run a supplemental search.
  Durable policy still performs one bounded judge and at most one supplemental round. Empty or
  normalized-equivalent supplemental queries no longer repeat deterministic recall. Complete V3
  checkpoint parsing permits the intentional no-judge state; a supplemental boundary still
  requires its judgement.
- Added one shared request budget and concurrency gate for PageIndex range opens across every
  original/subquery leg and the supplemental round. A resource is charged only after gate
  admission, immediately before physical I/O; canceled queued work does not consume the budget.
- Made the initial multi-intent rerank pool configurable with
  `KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES` (default and hard maximum `200`). It is distributed
  round-robin across the original query and up to three planned intents; selected counts are
  observable per list. One durable supplemental list remains independently bounded by the planner.
- Let the query-specific reranker own final relevance and use full RRF only as provenance and a
  deterministic tie-break. Supplemental merge sees the complete bounded initial result. Durable
  V3 checkpoints retain that candidate tail (up to the reviewed 200-item bundle bound), so resume
  cannot silently shrink to public Top K or the synthesis prompt limit.
- Reported parallel recall latency as the critical-path maximum while retaining explicit aggregate
  dense/FTS work counters. Added rewritten-query embedding time, outline counts, real graph
  execution presence, range-open counters, rerank pool/list counters, retrieval steps and budget
  exhaustion reasons. Research now reports rerank capability as `verified` when it was required and
  used.
- Reused one exported `RETRIEVAL_MAX_TOP_K` in production, dry-run, durable Research and test
  planners. The outer Research wrapper preserves the orchestrator's equal-score order.
- Expanded local English comparison triggers, normalized query deduplication, and required model
  confirmation before enabling a graph leg. The judge system prompt explicitly treats retrieved
  text as untrusted data. Structured output, no tools, same-tenant retrieval and one bounded
  supplemental query remain the security boundary.

## Compatibility and Operations

No database migration is required. The new rerank environment variable is optional; the reviewed
default preserves a hard bound. Operators lowering it trade multi-intent depth for cross-encoder
latency and can inspect `researchRerankCandidateBudget` plus `researchRerankListCandidates` to see
the effective selection. A durable supplemental list is additional, plan-bounded provider work and
is reported as another list rather than hidden inside the initial pool.

Database adapters without physical cancellation can finish detached work after the owner has
already received cancellation; result use, further scheduling and provider work stop immediately.
Adapters/providers with native signal support receive the same ownership signal and should cancel
the physical request.

## Verification

- Focused verification covers the Research HTTP contract, lease/client cancellation, hard
  wall-clock expiry, planner/judge cancellation, parallel fanout, PageIndex budget/concurrency,
  rerank pooling, supplemental RRF merge, durable tail replay and restored aggregate metrics (258
  tests across 19 files, plus the final 40-test cancellation/PageIndex/Research regression slice).
- The complete API suite passed 4,944 tests (three skipped), and the API app suite passed 293 tests.
  Both packages pass type checking. API coverage was 93.40% statements/lines, 96.00% functions and
  89.28% branches. The package's historical 90% global branch gate remains below threshold and is
  explicitly excluded by the repository's `test:coverage:ci` script; no functional test failed.
- OpenAPI export (2/2), Compose application assertions (14/14), backend formatting/lint (1,105
  files), Compose configuration rendering, the generated KnowledgeFS contract check and diff
  whitespace checks all pass.
