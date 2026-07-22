# Extract Operation Policy Routes

## Summary

- Extracted bulk operation and retention policy OpenAPI route definitions from `packages/api/src/index.ts` into `packages/api/src/operation-policy-routes.ts`.
- Covered bulk progress lookup, tenant retention policy read/update, and KnowledgeSpace retention policy read/update.
- Kept existing gateway handlers, repository lookups, and summary assembly unchanged.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `operation-policy-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway imports, and removed inline route definitions plus no-longer-needed route schema imports.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 7 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 3 more implementation commits.
