# Extract Agent Workspace Snapshot Routes

## Summary

- Extracted agent workspace snapshot OpenAPI route definitions from `packages/api/src/index.ts` into `packages/api/src/agent-workspace-snapshot-routes.ts`.
- Covered snapshot creation, lookup, and replay route contracts.
- Preserved existing gateway handler behavior and tenant-scoped repository access.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `agent-workspace-snapshot-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway imports, and removed inline route definitions.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 5 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 5 more implementation commits.
