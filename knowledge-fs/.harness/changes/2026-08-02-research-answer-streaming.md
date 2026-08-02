# Research Answer Streaming in Retrieval Test

## What Changed

- Added a durable `research_task.answer_delta` progress event and exposed it as the
  `answer.delta` SSE event while a research task generates its answer.
- Batched generated text before persisting progress, with an immediate first delta and
  subsequent 128-character batches. Explicit attempt-and-offset idempotency keys make
  replay and worker retries safe.
- Added PostgreSQL and TiDB migration `0035_research_task_answer_streaming` so the
  progress-event type constraint accepts answer deltas.
- Exposed the completed answer through the Dify KnowledgeFS partial-response DTO and
  regenerated the console and service API contracts.
- Added a live answer card to the Dify retrieval-test page. It reconstructs ordered SSE
  deltas, de-duplicates replayed offsets, resets on a newer execution attempt, renders
  Markdown while streaming, and replaces the stream with the persisted final answer
  when task partials refresh.
- Added behavioral coverage for delta publication and batching, SSE serialization,
  migration replay, DTO conversion, stream reconstruction, retry handling, live page
  output, and reopening completed research history.

## Why

Research mode previously showed only the retrieved evidence chunks even though the
runtime generated and persisted a final answer. Users can now read the answer as it is
generated and still get the durable completed answer after reconnecting or reopening a
history item.

## Performance and Reliability

- Generation output remains bounded by the existing 20,000-character answer limit.
- The batching contract avoids one database insert per model token. At the maximum
  answer size it produces no more than 158 durable answer-delta writes, while the first
  non-empty content remains visible immediately.
- Client reconstruction is linear in the bounded progress-event list and ignores
  malformed offsets, gaps, duplicate replays, and stale execution attempts.
- The final partial response remains authoritative, so an interrupted SSE connection
  does not make a completed answer unavailable.

## Verification

- `pnpm check`
- `pnpm build`
- `pnpm db:migrations:check`
- `pnpm --filter @knowledge/database exec vitest run src/migration-file.test.ts src/research-task-answer-streaming-migration.test.ts src/schema.test.ts`
- `pnpm --filter @knowledge/adapters exec vitest run src/migration-runner.test.ts`
- `pnpm --filter @knowledge/api-app exec vitest run src/migrate.test.ts`
- `uv run --project api pytest api/tests/unit_tests/services/test_knowledge_fs_product_dto.py`
- `pnpm gen-api-contract`
- `pnpm type-check` in `packages/contracts`
- `pnpm exec vp test features/new-rag/__tests__/research-task-events.spec.ts features/new-rag/__tests__/retrieval-test-page.spec.tsx` in `web`
- `pnpm exec vp check --fix` against the changed frontend files
- Targeted Biome checks against all changed KnowledgeFS TypeScript files
- `git diff --check`

## Known Risks / Follow-Up

- Deploy migration `0035` before workers begin publishing `research_task.answer_delta`;
  older database constraints reject the new event type.
- Full `pnpm lint` is not green because of existing unrelated Admin formatting/import
  findings, an OpenAPI JSON file above Biome's 1 MiB limit, and existing capability JSON
  formatting. All changed KnowledgeFS files pass targeted Biome checks, and the full
  `pnpm check` gate passes.
- Interactive browser verification was not run because no authenticated local Dify and
  KnowledgeFS fixture was available. React Testing Library covers the observable live
  and reopened-history behavior.
- Temporary progress documents were previously retired and were not recreated; this
  change record is the traceability source for this slice.
