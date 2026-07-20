# Extract Answer Trace Routes

## Summary

- Extracted answer trace and query virtual-tree OpenAPI route definitions from `packages/api/src/index.ts` into `packages/api/src/answer-trace-routes.ts`.
- Covered trace lookup and evidence, conflict, and missing-information virtual tree routes.
- Preserved existing tenant-scoped answer trace access and virtual entry pagination behavior.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `answer-trace-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway imports, and removed inline route definitions.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 6 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 4 more implementation commits.
