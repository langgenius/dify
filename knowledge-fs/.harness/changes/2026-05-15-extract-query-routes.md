# Extract Query Routes

## Summary

- Extracted the streaming query OpenAPI route definition from `packages/api/src/index.ts` into `packages/api/src/query-routes.ts`.
- Preserved existing query generation handler behavior and SSE response wiring.
- Removed the now-unneeded `z` import from the gateway entrypoint.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `query-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway import, and removed the inline route definition.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 9 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 1 more implementation commit.
