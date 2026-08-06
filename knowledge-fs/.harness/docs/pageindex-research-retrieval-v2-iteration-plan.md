# PageIndex Research Retrieval V2 Iteration Plan

> Created: 2026-08-05
> Status: Complete
> Scope: KnowledgeFS backend, backend tests, contracts, and operational documentation only.

## 1. Decision Summary

Research retrieval uses document selection before book-like document-tree navigation. For each
selected document, the production LLM lane starts at the root table of contents, evaluates only the
currently visible sibling level, and returns `expand` or `open` decisions. `expand` exposes that
chapter's direct children on the next step; `open` selects the current immutable range as evidence.
The frontier, visited nodes, open selections, and budget counters are checkpointed after each
successful level for durable tasks. The compact whole-tree selector remains a compatibility path,
not the production default. Bounded candidate flattening and Value-only navigation are fallbacks
when layered navigation is unavailable or recoverably degraded. Semantic Value Search runs in
parallel and contributes document and node priors to the same bounded node queue.

Interactive Research and durable Research Tasks share one retrieval engine but use different
execution policies. Interactive requests allow one bounded supplemental search and do not persist
checkpoints. Durable tasks may run a full sufficiency loop and persist replay-safe checkpoints.

Recoverable provider/search-lane failures degrade to remaining safe lanes. Authorization,
publication-snapshot, tenant-scope, and frozen-model integrity failures remain fail-closed.

## 2. Explicit Non-Goal

This iteration does **not** automatically generate Golden Questions. Findability evaluation may
consume existing human-maintained Golden Questions with expected evidence ids. A document or space
without sufficient human-maintained questions is reported as `not-evaluated` and is never blocked
or routed differently merely because questions are absent.

## 3. Guardrails

- No frontend changes.
- No browser-to-KnowledgeFS direct path.
- Every read stays bound to the immutable publication snapshot and server-issued permission scope.
- Candidate, outline, node, evidence, prompt, and checkpoint collections have explicit limits.
- Document/outline loading is batched; no per-document database query waterfall.
- Internal scheduling values are not exposed as end-user relevance scores.
- Behavioral work follows RED -> GREEN -> REFACTOR and keeps package coverage at or above 90%.

## 4. Iterations

### RRV2.0 — Planning and contracts

Priority: P0

Tasks:

1. Add this plan to the consolidated execution index.
2. Define interactive and durable execution-policy contracts.
3. Define degradation reason codes and the boundary between recoverable and integrity failures.
4. Define per-level prompt budgets, maximum traversal depth, and bounded frontier limits.

Acceptance:

- The active plan names every slice below and explicitly excludes automatic question generation.
- Policy defaults are deterministic and validated by unit tests.

### RRV2.1 — Batched document selection

Priority: P0

Tasks:

1. Aggregate normalized dense hits by `documentAssetId` using
   `sum(top-M hit scores) / sqrt(M + 1)`.
2. Select a bounded document shortlist before loading outlines.
3. Add a publication/ACL-safe batch outline lookup for selected document ids.
4. Preserve explicit document filters and deterministic tie-breaking.

Acceptance:

- Research never loads every outline merely to find the dense-selected documents.
- One long document cannot win only by contributing unbounded chunks.
- Permission and publication filtering occurs before an outline is visible to the LLM.

Verification:

- Pure document-score tests.
- In-memory and database repository batch-read tests.
- Research retrieval tests for multi-document ranking and stable ties.

### RRV2.2 — Checkpointed layered PageIndex navigation

Priority: P0

Tasks:

1. Start from root outline nodes and serialize only the current bounded sibling frontier with stable
   node ids, titles, summaries, paths, child counts, locations, and Value priors; never include body
   text.
2. Require strict `expand`/`open` decisions. `expand` schedules only direct children for the next
   level, while `open` records an immutable evidence range.
3. Estimate every level's prompt tokens conservatively for ASCII and CJK text and cap frontier size,
   selected nodes, depth, model calls, response size, and provider timeout.
4. Persist traversal state after every successful level so durable retries resume from the exact
   frontier instead of starting at the root.
5. Keep provider/model identity and persisted-checkpoint scope validation fail-closed; recoverable
   failures degrade to bounded Value/hybrid retrieval.
6. Retain whole-tree selection only as a lower-level compatibility path.

Acceptance:

- A depth-N relevant path is navigated as N bounded table-of-contents decisions, like opening a
  book chapter by chapter.
- Unrelated descendants are never exposed merely because they exist elsewhere in the document.
- Oversized frontiers and deep trees cannot create unbounded work.
- Malformed model output never silently changes the frontier or selected node set.
- A durable retry resumes from the last persisted level without repeating completed model calls.

Verification:

- Layer-by-layer depth-four traversal and sibling-isolation tests.
- Frontier/token/depth budget tests.
- Checkpoint resume, fallback, and malformed-contract tests.

### RRV2.3 — Value propagation, node queue, and evidence opening

Priority: P0

Tasks:

1. Convert dense hits to local outline-node values.
2. Propagate ancestor `peakValue` using max; retain bounded `breadthValue` as a tie-break signal.
3. Merge LLM-selected and Value-selected nodes by publication/outline/node identity.
4. Open a bounded number of selected ranges through `openLeafEvidence` and deduplicate projection
   and evidence ids.
5. Keep low-quality/oversized trees on a bounded Value/legacy hybrid fallback.

Acceptance:

- Internal-node priorities do not grow just because a subtree contains more chunks.
- Evidence is read only from selected, readable, immutable outline ranges.
- Final evidence ordering is deterministic.

Verification:

- Peak/breadth propagation tests.
- Queue merge and evidence deduplication tests.
- Selected-range repository integration tests.

### RRV2.4 — Interactive and durable execution policies

Priority: P0

Tasks:

1. Thread an internal execution policy from query/task generators into Research retrieval.
2. Interactive policy: layered navigation + Value in parallel, at most six tree levels, bounded
   evidence opening, at most one supplemental search, strict wall-clock/model-call limits, and no
   durable checkpoint.
3. Durable policy: bounded multi-round sufficiency loop, actual budget counters, and checkpoint
   persistence after replay-safe boundaries.
4. Reuse the same core engine rather than maintaining divergent algorithms.

Acceptance:

- Interactive latency grows only with the bounded relevant path and cannot exceed configured
  depth, model-call, concurrency, or wall-clock limits.
- Durable tasks can resume after a provider timeout without repeating completed tree decisions and
  opened evidence.

Verification:

- Policy-routing generator tests.
- Interactive max-round tests.
- Durable retry/checkpoint lifecycle tests.

### RRV2.5 — Degraded and partial result semantics

Priority: P0

Tasks:

1. Retry one recoverable LLM tree-selection contract/provider failure within its bounded deadline.
2. If retry fails, continue with the Value lane and record structured degradation trace metadata.
3. Keep ACL, tenant, publication snapshot, membership, and frozen-model mismatches terminal.
4. Derive `EvidenceBundle.state` from evidence sufficiency, independently from execution
   degradation.
5. Return `partial` on exhausted budget with useful but insufficient evidence; return
   `not-enough-evidence` when no useful evidence exists.

Acceptance:

- One malformed model batch no longer fails an otherwise safe Value result.
- A degraded query may still be `answerable` when its remaining evidence is sufficient.
- Integrity failures cannot be hidden as degraded success.

Verification:

- Failure taxonomy and retry tests.
- Evidence state/degradation trace tests.
- Fail-closed scope/snapshot/model tests.

### RRV2.6 — Research planning and runtime budgets

Priority: P0

Tasks:

1. Replace fixed Research estimates with policy-derived minimum, expected, and maximum work.
2. Include document selection, layered traversal calls, compatibility/fallback calls, evidence
   opens, sufficiency rounds, and final synthesis.
3. Enforce runtime counters for model calls, retrieval steps, opened resources, wall time, and
   actual model cost where provider usage is available.
4. Keep plan/admission estimation distinct from runtime hard enforcement.

Acceptance:

- `/research-tasks/plan` no longer assumes exactly three Research retrieval steps.
- Maximum estimates correspond to actual configured loop limits.
- Budget exhaustion terminates through the partial-result semantics above.

Verification:

- Dry-run planner tests for interactive/durable policies and min/expected/max bounds.
- Runtime budget boundary tests.

### RRV2.7 — Human-golden findability evaluation

Priority: P1

Tasks:

1. Evaluate title+summary-only layered navigation against existing human-maintained Golden
   Questions.
2. Map expected evidence ids to covering outline nodes/ranges without exposing body text to the
   selector.
3. Report Recall@K, reciprocal rank, path recall, abstention behavior, sample count, and evaluator
   provenance.
4. Persist exact-generation results, route sufficiently sampled low-findability documents to hybrid
   fallback, and enqueue at most one durable summary repair per document version; do not block
   publication or unevaluated documents.

Acceptance:

- No Golden Questions are created by this iteration.
- Insufficient or absent human labels produce `not-evaluated`, not a failing score.
- Quality decisions retain sample count, evaluator version, model, and prompt version.

Verification:

- Manual-golden fixture tests for pass/fail/not-evaluated cases.
- Evidence-to-outline mapping tests.
- No-auto-generation guard test.

### RRV2.8 — Contract, regression, and operational closure

Priority: P0

Tasks:

1. Update OpenAPI/capability artifacts only when public contracts intentionally change.
2. Add focused long-document and multi-document regression fixtures.
3. Record metrics for selected documents, layered steps, visited/frontier nodes, serialized prompt
   tokens, compatibility/fallback strategy, LLM/Value contributions, opened ranges, rounds,
   degradation, and budget termination.
4. Update API/reference/runbook and `.harness/changes` records.

Acceptance:

- Targeted tests, package tests, typecheck, lint, build, coverage, migration checks, and contract
  checks pass.
- Any intentionally skipped external integration test is documented with its reason.

## 5. Execution Order

```text
RRV2.0
  -> RRV2.1
  -> RRV2.2
  -> RRV2.3
  -> RRV2.4
  -> RRV2.5
  -> RRV2.6
  -> RRV2.7
  -> RRV2.8
```

RRV2.5 failure semantics are applied while implementing RRV2.2-RRV2.4 rather than postponed as a
late error-handling rewrite. RRV2.7 is independent of automatic question generation and can ship
after the retrieval engine is stable.

## 6. Execution Status

| Slice | Status | Completion evidence |
|---|---|---|
| RRV2.0 | Implemented | Policy/failure/budget contracts and this bounded iteration plan are present. |
| RRV2.1 | Implemented | Document scoring, shortlist, batch outline lookup, and repository tests pass. |
| RRV2.2 | Implemented | Root-to-leaf layered navigator, strict expand/open contract, bounded frontier/depth, per-level durable checkpoints, and compatibility fallback tests pass. |
| RRV2.3 | Implemented | Node Value propagation, max ancestor prior, deterministic queue, and bounded evidence-open tests pass. |
| RRV2.4 | Implemented | Interactive/durable policies, sufficiency rounds, replay-safe partial checkpoints, and resume tests pass. |
| RRV2.5 | Implemented | Recoverable degradation, terminal integrity failures, and partial evidence-state tests pass. |
| RRV2.6 | Implemented | Runtime counters and dry-run min/estimated/max work bounds are covered by tests. |
| RRV2.7 | Implemented | Exact-generation human-label evaluation, durable routing score, and bounded summary-repair queue are wired into publication; no question generator was added. |
| RRV2.8 | Done 2026-08-06 | Full workspace tests/typecheck/lint/build, 90% API branch coverage, migration/OpenAPI/evaluation gates, and the refreshed Dify contract lock pass. |
