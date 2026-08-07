# PageIndex Research Retrieval V2

Date: 2026-08-05

## What changed

- Added bounded document selection before outline loading. Dense Value hits are deduplicated,
  aggregated with diminishing returns, and used for one publication/ACL-safe batch outline read.
- Added a book-like layered LLM navigator. Each request contains only the currently visible sibling
  frontier with compact title, summary, path, location, child-count, and Value metadata—never body
  text. `expand` descends into direct children; `open` selects the current immutable range.
- Added replay-safe per-level traversal checkpoints. Durable retries resume from the exact frontier
  without repeating completed chapter decisions. The whole-tree selector is retained only for
  compatibility; recoverable layered failures degrade to bounded hybrid/Value navigation.
- Added outline-node Value propagation, max-based ancestor priors, deterministic LLM/Value node
  queue merging, concurrent selected-range opening, and evidence deduplication.
- Added explicit interactive and durable execution policies with counters for rounds, model calls,
  opened resources, retrieval steps, continuation searches, and wall-clock time.
- Added durable navigation and round checkpoints. A retrieval retry resumes layered navigation from
  its last successful level, and a synthesis retry rehydrates the latest scoped immutable evidence
  bundle without repeating embedding, completed tree decisions, or evidence reads.
- Changed recoverable tree-lane failures to structured degradation while retaining fail-closed
  behavior for authorization, tenant, publication-snapshot, checkpoint-scope, and frozen-model
  integrity failures.
- Added policy-derived dry-run `workBounds` and Research retrieval metrics for document strategy,
  serialized tree size, rounds, sufficiency, degradation, and budget termination.
- Added an exact-generation human-Golden-Question findability evaluator with Recall@K, MRR, path
  recall, abstention, provenance, durable hybrid routing, and a leased/bounded summary-repair queue.

## Explicit non-goal

This iteration does not generate Golden Questions. The new evaluator only consumes existing
human-maintained questions. Missing or insufficient labels return `not-evaluated`, leave routing
unchanged, and do not enqueue summary repair.

## Why

The previous Research implementation scored flattened candidates in multiple model batches. It did
not select documents first, flattened the hierarchy, and failed an entire query when a recoverable
scoring batch failed. The V2 path follows the document/tree shape: use semantic retrieval as a
bounded Value prior, start at the table of contents, descend only through relevant chapters, and
open only selected immutable ranges. Online and durable products share the algorithm while
enforcing different depth, latency, budget, and replay policies.

## Verification

- Workspace backend lint: 1,007 files checked, no diagnostics.
- Workspace tests: all 22 Turbo tasks passed; `@knowledge/api` reported 390 test files passed,
  4,252 tests passed, with one file/three external-database tests intentionally skipped.
- Workspace TypeScript checks passed for all 12 packages.
- Workspace production build passed for all 12 packages.
- `@knowledge/api` coverage passed: lines/statements 93.90%, functions 96.39%, branches 90.00%.
- Focused document-selection, layered navigation, compatibility whole-tree, Value propagation,
  queue, policy, checkpoint, planner, failure-state, findability, repository, generator, runtime,
  gateway, and API-wiring tests pass.
- Migration artifacts and hermetic OpenAPI/capability export tests pass.
- Retrieval regression passed with Recall@K 0.890, citation hit rate 0.880, no-answer rate 0.060,
  citation accuracy 0.890, and faithfulness 0.910; the Phase 4 evaluation report also passed.
- OpenAPI/capability contract lock is intentionally refreshed after the public dry-run response
  gained optional `estimates.workBounds`.

## Performance and safety bounds

- Interactive Research selects at most five documents and executes one evidence round under a
  30-second retrieval budget; durable Research selects at most ten documents and executes at most
  three rounds under a 300-second budget.
- Each layered frontier is capped by node count, depth, conservative prompt-token estimate, output
  contract, provider timeout, model calls, and concurrency. Document outline reads are batched.
- All evidence remains scoped to one immutable publication fingerprint and server-issued permission
  scope. Internal DocScore and node priors are not exposed as final user relevance scores.
- Recoverable provider failures may degrade; scope, snapshot, and model-identity failures cannot.

## Files of note

- `packages/api/src/page-index-document-selection.ts`
- `packages/api/src/page-index-layered-tree-search.ts`
- `packages/api/src/page-index-whole-tree-selection.ts`
- `packages/api/src/page-index-node-values.ts`
- `packages/api/src/page-index-node-queue.ts`
- `packages/api/src/published-page-index-retrieval.ts`
- `packages/api/src/research-retrieval-policy.ts`
- `packages/api/src/research-retrieval-checkpoint.ts`
- `packages/api/src/page-index-findability-evaluation.ts`
- `packages/api/src/page-index-findability-repository.ts`
- `packages/api/src/page-index-summary-repair-runtime.ts`
- `docs/pageindex-research-retrieval-v2.md`
