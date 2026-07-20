# Extract Graph Routes

## Summary

- Extracted the graph traversal OpenAPI route definition from `packages/api/src/index.ts` into `packages/api/src/graph-routes.ts`.
- Kept graph traversal handler logic and response assembly in the gateway flow unchanged.
- Added a code-health guardrail to keep graph route definitions out of the gateway god file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `graph-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway import, and removed the inline route definition.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 8 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 2 more implementation commits.
