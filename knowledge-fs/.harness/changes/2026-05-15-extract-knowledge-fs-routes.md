# Extract KnowledgeFS Routes

## Summary

- Extracted all KnowledgeFS OpenAPI route definitions from `packages/api/src/index.ts` into `packages/api/src/knowledge-fs-routes.ts`.
- Covered list, tree, grep, find, diff, open-node, cat, and stat route contracts.
- Removed direct `createRoute` usage from the gateway entrypoint, leaving it focused on handler wiring and runtime composition.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `knowledge-fs-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway imports, and removed inline route definitions plus no-longer-needed route schema imports.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 10 after review checkpoint `ba4d2c9`.
- A mandatory project health review must run immediately after this commit is pushed before further feature work.
