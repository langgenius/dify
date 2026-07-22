# Extract Research Task Routes

## Summary

- Extracted research task OpenAPI route definitions from `packages/api/src/index.ts` into `packages/api/src/research-task-routes.ts`.
- Covered dry-run planning, job creation/status, partial-result listing, SSE progress, and cancellation route contracts.
- Kept existing gateway handler wiring and repositories unchanged.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `research-task-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway imports, and removed the inline definitions plus no-longer-needed schema constant imports.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 4 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 6 more implementation commits.
