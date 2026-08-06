# Trace History Retrieval Statistics

## What Changed

- Added `resultCount` and optional `durationMs` to KnowledgeFS quality trace summaries and their OpenAPI schema.
- Derived the result count from the trace's existing evidence bundle items.
- Derived duration from the earliest valid trace-step start time to the latest valid trace-step end time.
- Passed the fields through the Dify KnowledgeFS product DTO and generated console/service contracts.
- Updated the New RAG retrieval-test history model so refreshed historical records render `x chunks in y ms`.

## Why

- Retrieval Test already displayed chunk count and elapsed time for a run completed in the current browser session, but a trace refetch or page reload replaced that summary with the retrieval mode label.
- The underlying evidence items and step timestamps were already durable, so historical statistics can be restored without a migration or duplicated persistence.

## Performance Notes

- Trace history still uses the existing bounded trace query, evidence-bundle join, and one batched trace-step query.
- No per-trace query or new database round trip was added.
- Duration calculation is in-memory over the already-loaded, bounded step rows.

## Verification

- `pnpm exec vitest run src/quality-control-database-repository.test.ts` from `knowledge-fs/packages/api` (63 passed).
- `pnpm --filter @knowledge/api test` from `knowledge-fs` (4,137 passed, 3 skipped).
- `pnpm --filter @knowledge/api typecheck` from `knowledge-fs`.
- `pnpm build` from `knowledge-fs` (12 packages succeeded).
- Targeted `pnpm exec biome check` for the four changed KnowledgeFS TypeScript files.
- `uv run --project api pytest api/tests/unit_tests/services/test_knowledge_fs_product_dto.py api/tests/unit_tests/services/test_knowledge_fs_data_facade.py -q` (122 passed).
- Targeted Ruff lint and format checks for the changed Dify Python files.
- `vp test run features/new-rag/__tests__/retrieval-test-model.spec.ts features/new-rag/__tests__/retrieval-test-page.spec.tsx` from `web` (30 passed).
- Browser reload verified an existing trace rendered `0 chunks in 2 s`; selecting it set `aria-pressed=true`.
- Dify API, KnowledgeFS health/readiness, Celery worker/queues, and Vinext were checked through the local New RAG chain.

## Skipped / Baseline Checks

- `pnpm check` from `knowledge-fs` was not run because it includes the full Docker, compose, evaluation, coverage, and local happy-path CI matrix; the affected package tests, typecheck, build, OpenAPI generation, and local runtime were run instead.
- Full `pnpm lint` from `knowledge-fs` reports 10 pre-existing errors in unrelated admin files and the 1.5 MiB generated OpenAPI document. The changed KnowledgeFS files pass targeted Biome checks.

## Known Risks / Follow-Up

- Traces with no valid completed step timestamps omit `durationMs`; the UI intentionally falls back to the retrieval mode for those legacy or incomplete records.
- Result count reflects durable evidence-bundle items, which is the same evidence set exposed by the trace.
