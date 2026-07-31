# Model runtime timeout retry

Date: 2026-07-30

## What changed

- Durable document compilation now preserves the `retryable: true` contract exposed by model and
  provider errors instead of classifying every non-`DocumentCompilationProcessingError` as a
  terminal failure.
- A provider's stable error code is retained when present. Retryable errors without a code use
  `DOCUMENT_COMPILATION_RETRYABLE`; non-`Error` values remain terminal and fail closed.
- Added regression coverage proving that `dify_model_runtime_timeout` transitions an attempt to
  `retry_wait`, records the provider error, acknowledges the current queue delivery, and lets the
  durable outbox schedule the next execution.
- No frontend, API contract, database schema, migration, or deployment configuration changed.

## Why

Production evidence for document `权责蓝图.html` showed a model request failing exactly at the
60-second client deadline while the OpenAI plugin subprocess restarted. The compilation attempt
had already reached `outline_built`, had persisted its outline and 81 FTS projections, and had not
created any dense-vector projection. Although `DifyModelRuntimeError` marked the timeout
retryable and the attempt allowed five executions, the default compilation classifier discarded
that flag and terminalized the first execution as `DOCUMENT_COMPILATION_FAILED`.

Preserving the provider retry contract allows the existing durable backoff/outbox path to resume
from `outline_built`. Together with checkpoint recovery, the retry rebuilds only failed
projections and does not reparse the document, regenerate PageIndex, or repeat the outline LLM
summaries.

## Database access and performance

- No new database query or index is introduced.
- A timeout now uses the existing bounded `scheduleRetry` transaction and outbox redelivery path.
- Retry count remains capped by `max_execution_attempts`; existing exponential backoff and lease
  fencing are unchanged.
- Resumed indexing continues to use batched failed-projection cleanup and the persisted
  parse-artifact/outline checkpoints.

## Verification

- TDD red phase: the new runtime regression failed with `failed: 1` and `retryScheduled: 0`.
- Green phase:
  - `pnpm exec vitest run src/document-compilation-runtime.test.ts`
  - 1 file, 32 tests passed.
- `pnpm --filter @knowledge/api test:coverage` passed:
  - lines/statements: 93.88%
  - functions: 96.35%
  - branches: 90.00%
- `pnpm exec biome check packages/api/src/document-compilation-runtime.ts
  packages/api/src/document-compilation-runtime.test.ts` passed.
- `pnpm check` passed, including workspace tests, coverage gates, retrieval evaluation,
  migration artifacts, contract/workflow checks, and Compose validation.
- `pnpm build` passed for all 12 packages.
- `pnpm lint` remains blocked by 10 pre-existing repository-wide findings in unchanged Admin,
  test-fixture, OpenAPI, and generated capability-contract files. The changed API files pass the
  focused Biome check above.

## Risks and follow-up

- A provider can opt into durable retry only by throwing an `Error` instance with
  `retryable: true`; arbitrary thrown objects cannot activate retry.
- Existing terminal attempts still require one manual retry after deployment. Future transient
  model-runtime failures retry automatically up to the attempt's configured execution limit.
- Repeated provider outages still terminalize after the configured maximum attempts; this keeps
  retry traffic bounded.
