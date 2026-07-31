# Research progress and structured semantic scoring hardening

Date: 2026-07-31

## What changed

- Routed PageIndex semantic candidate scoring through Dify's structured-output LLM endpoint.
  Each bounded scoring batch now supplies a strict JSON schema for the exact candidate ids, while
  the existing KnowledgeFS parser continues to reject missing, duplicated, unknown, or invalid
  scores. The production batch size was reduced from ten candidates to five.
- Updated the Dify model-runtime client and generation provider to carry structured-output schemas,
  consume Dify's validated `structured_output` stream field, and retain free-form response text
  only as a compatibility fallback.
- Kept Research task stage transitions synchronized with heartbeat-updated row versions inside the
  serialized lease lane, preventing a heartbeat from making the next durable transition use a
  stale fence.
- Made the Research progress database repository accept PostgreSQL `BIGINT` timestamps returned as
  bounded decimal strings while preserving non-negative safe-integer validation.
- Added Retrieval Test progress streaming through the console-issued Research capability, including
  bounded SSE replay, cursor reconnects, terminal task/partial refreshes, actual per-stage timing,
  and process-log presentation.
- Split active Research stage labels from completed milestone labels in every supported Web locale.
  A streamed completion now refreshes the task first and leaves the existing active-to-completed
  transition guard as the single owner of the final partial-result refresh. Historical terminal
  replay does not trigger redundant task or partial requests.

## Why

- Free-form LLM output could spend tokens on prose or return malformed JSON before semantic scores,
  even though Dify already owns tenant-scoped structured-output invocation and validation.
- Research heartbeats increment the durable row version while generation is running. Stage
  transitions must read the latest fence from the same serialized lane to avoid false lease loss.
- PostgreSQL drivers commonly expose `BIGINT` values as strings, so valid persisted progress events
  could fail when read back.
- Polling alone did not expose durable Research stage history or precise timing, while mixing SSE
  terminal refreshes with the existing completion guard caused duplicate partial reads.
- Completed-milestone copy was misleading when reused for a stage that was still running.

## Verification

- Web Retrieval Test and Research event-stream focused suites pass.
- KnowledgeFS API semantic scoring, progress database, and Research runtime focused suites pass.
- Dify model-runtime client and generation-provider focused suites pass.
- TypeScript checks pass for `@knowledge/api`, `@knowledge/dify-model-runtime-client`, and
  `@knowledge/generation`.
- Focused KnowledgeFS Biome checks, Web i18n synchronization, and `git diff --check` pass.
- The repository-wide Web TypeScript command remains blocked by pre-existing generated
  `.next/types/validator.ts` route declarations unrelated to this change.
- Vite+ static `check` remains unavailable in the current local environment because its launcher
  cannot resolve the Node binary; focused tests, i18n validation, KnowledgeFS Biome, and package
  typechecks were used instead.

## Performance and operational bounds

- Semantic scoring still uses at most four concurrent LLM batches, with five candidates per batch,
  bounded candidate text, output tokens, response characters, and per-batch timeouts.
- Research SSE responses remain server-bounded by page limit and connection duration. Clients
  reconnect from the last durable sequence cursor rather than retaining an unbounded connection.
- Completed tasks perform one final partial refetch through the existing transition guard. Replayed
  historical terminal events do not add redundant refresh requests.

## Risks and follow-up

- Smaller semantic-score batches increase the number of model calls for the same candidate window,
  trading request count for more reliable structured responses within the configured output budget.
- Providers without native structured output still rely on Dify's prompt-based parsing before the
  strict KnowledgeFS validation boundary.
- Progress history is held only for Research tasks selected during the current Retrieval Test page
  session; switching or reloading reconstructs it from the durable cursor stream.
