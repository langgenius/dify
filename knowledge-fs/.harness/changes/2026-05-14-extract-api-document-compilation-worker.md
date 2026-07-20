# Extract API Document Compilation Worker

## Summary

- Extracted durable document compilation worker contracts, payload validation, parser/reindex orchestration, failure marking, and ingestion smoke evaluation gate from `packages/api/src/index.ts` into `packages/api/src/document-compilation-worker.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing worker logic from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Keeps durable ingestion worker behavior close to its dependencies instead of inside HTTP route composition.

## TDD

- RED: added a code-health guardrail first; it failed because `document-compilation-worker.ts` did not exist.
- GREEN: moved the worker/smoke-gate implementation, re-exported it, and reran focused gateway/code-health tests.

## Performance Notes

- Runtime behavior is unchanged: compilation still reads one bounded object by key, parses once, reindexes once, and advances the job state machine.
- Failure handling remains best-effort and bounded: parser status and job failure are updated without retry loops or extra object reads.
- No new database queries, object-storage calls, unbounded scans, or memory retention paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 7 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
