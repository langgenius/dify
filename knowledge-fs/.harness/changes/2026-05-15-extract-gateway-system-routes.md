# Extract Gateway System Routes

## Summary

- Moved the public `/health` OpenAPI route constant out of `packages/api/src/index.ts`.
- Added `packages/api/src/gateway-system-routes.ts` and re-exported it from the API package entrypoint.
- Kept runtime health aggregation in the gateway handler while separating the static route definition.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-system-routes.ts` did not exist.
- GREEN: Extracted `healthRoute` and added a code-health guardrail that keeps system route definitions out of `index.ts`.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This will be implementation commit 7 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 3 more implementation commits.
