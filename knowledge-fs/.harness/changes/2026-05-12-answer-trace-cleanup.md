# AnswerTrace Cleanup

## What Changed

- Added `AnswerTraceRepository.deleteOlderThan({ knowledgeSpaceId, olderThan, maxTraces })`.
- Implemented bounded in-memory cleanup for old traces scoped to one knowledge space.
- Implemented database-backed cleanup that deletes trace steps before traces using parameterized SQL and bounded trace-id subqueries.
- Added tests covering old trace deletion, recent and cross-space preservation, max cleanup bounds, invalid limits, and DB parameterization.

## Why

- Sprint 12 cleanup jobs need a trace retention primitive so stored answer traces do not grow without bounds.
- Unlike index projections, `AnswerTrace` already has `createdAt`, so this slice can implement true age-based cleanup.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `deleteOlderThan` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- This adds the repository cleanup primitive but does not yet schedule AnswerTrace cleanup through the job queue.
- API coverage remains above the 90% package gate, but branch coverage is close to the threshold and should be watched in the next API-heavy slice.
