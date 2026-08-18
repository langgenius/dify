# Research judge recovery and semantic-window latency

Date: 2026-08-18

## What changed

- Bumped newly generated semantic compilations to `semantic-chunking-v4`.
- V4 assigns every model request a fixed core range. Look-ahead units remain visible as read-only
  context, but the response may not consume them. This makes windows independent and permits a
  bounded, order-preserving concurrent map.
- Added a per-document semantic-window concurrency limit. Production wires it to the existing
  `KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY` setting (default 4, hard maximum 32), while the
  existing process-wide model gate still limits aggregate provider pressure.
- Propagated the document compilation `AbortSignal` through the semantic chunker and into active
  model streams, so cancellation does not leave model calls running until their transport timeout.
- Preserved v1/v2/v3 planning and replay. If a historical generation has nodes but predates the
  durable generation receipt, replay now derives the frozen prompt version from the stored node
  provenance instead of applying the current v4 default.
- Strengthened the Research evidence judge prompt to require a JSON boolean for `sufficient` and
  safely normalizes unambiguous provider strings such as `不足。...` or `sufficient.` before strict
  schema validation.
- Marked deterministic Research response-contract failures non-retryable. Provider/network and
  timeout failures remain retryable, but malformed structured output no longer spends all five
  durable attempts.
- Corrected the ingestion benchmark's concurrent failure injector to bind failure to the physical
  call ordinal captured before its delay.

## Why

The deployed import of `权责蓝图.html` completed successfully but took 346.474 seconds. Its seven
semantic model calls ran serially and consumed 271.741 seconds in total; three outline-summary
calls consumed another 66.679 seconds. Semantic and outline model work therefore accounted for
about 97.6% of the observed import wall time. Reducing an earlier 80-call plan to seven bounded
calls fixed output-size correctness, but did not remove the serial latency waterfall.

The failed Research task retrieved and reranked the correct Apple evidence (top score
0.9978258). Its judge provider returned valid JSON, but used a Chinese explanation in the boolean
`sufficient` field. Strict validation rejected that one field and the durable runtime repeated the
same deterministic failure five times. Retrieval, outline, Graph, embedding, and rerank were not
the failing components.

## Correctness and performance invariants

- V4 windows cover the immutable parser units exactly once and preserve source order. A response
  that consumes read-only look-ahead is rejected before checkpoint or node materialization.
- Concurrent completion order cannot alter persisted chunk order, offsets, section provenance,
  entity/relation grounding, or compact receipt order.
- Successful independently completed windows retain their durable checkpoints if a peer fails;
  retries only call the missing windows.
- Per-document concurrency is bounded, and every physical provider request still acquires the
  shared process-wide model gate and document model budget.
- V3 remains the explicit compatibility mode for historical responses that committed a final
  range into look-ahead.
- Research normalization accepts only unambiguous boolean prefixes. Ambiguous or otherwise invalid
  structured output still fails closed and now terminates after one attempt.

## Measured evidence

- Production baseline for the latest supplied HTML import: 346.474 seconds end to end; seven
  semantic calls, 58,423 semantic tokens, and 271.741 seconds of summed semantic-provider time.
- For that exact seven-call duration trace, a four-worker list-scheduling replay has a 92.968-second
  semantic critical path instead of 271.741 seconds. This is a trace-based scheduling calculation,
  not a post-deployment latency measurement. V4 can plan eight fixed-core calls for this artifact,
  so no end-to-end percentage is claimed before redeployment and re-import.
- The observed failed Research task spent five judge calls and USD 0.067284 before exhausting its
  attempts. The exact returned payload is now accepted as `sufficient=false`; other deterministic
  contract failures stop after one attempt. This removes four known-wasted retries for the observed
  failure shape, but is not presented as a corpus-wide cost estimate.
- The controlled ingestion benchmark still reports provider-call counts separately from elapsed
  time. After fixing its concurrent failure injection, the three-window checkpoint scenario uses
  four calls instead of six across failure and retry (33.33% fewer); its millisecond fake-provider
  timings are not used as production performance evidence.

## Verification

- TDD regressions cover fixed-core concurrent execution, concurrency bounds, deterministic output
  ordering, read-only look-ahead rejection, compilation cancellation, v3 look-ahead compatibility,
  legacy v3 replay without a receipt, production-shaped Research normalization, and immediate
  terminal handling of explicitly non-retryable errors.
- Focused Research/semantic suite: 107 tests passed.
- Complete `@knowledge/api` suite: 416 files passed, 1 skipped; 4,595 tests passed, 3 skipped.
- Complete `@knowledge/api-app` suite: 45 files and 258 tests passed.
- `@knowledge/api` and `@knowledge/api-app` typechecks passed.
- Focused Biome checks and `git diff --check` passed.
- `pnpm --dir knowledge-fs benchmark:ingestion` completed with the corrected concurrent failure
  scenario.
- Full `pnpm --dir knowledge-fs check` and `pnpm --dir knowledge-fs build` passed.
- Full `pnpm --dir knowledge-fs lint` was attempted but remains blocked by pre-existing diagnostics
  in unchanged Admin files and generated OpenAPI/Capability artifacts. The ten changed source and
  test files pass the focused Biome gate.

## Known risks and follow-up

- Fixed-core parallelism intentionally forbids a chunk from crossing a window ownership boundary.
  Eight units of look-ahead preserve topic context, but a boundary-spanning chunk that v3 could
  merge will become adjacent chunks under v4. Retrieval quality must be compared after deployment.
- Provider throttling can reduce the realized latency gain. The per-document and global gates are
  deliberately configurable rather than bypassed.
- Real end-to-end improvement must be measured by re-importing the same HTML after deployment and
  comparing stage metrics. No production-after figure exists in this local change.
