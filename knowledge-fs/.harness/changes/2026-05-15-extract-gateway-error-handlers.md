# Extract Gateway Error Handlers

## Summary

- Moved gateway `onError` and `notFound` handling out of `packages/api/src/index.ts`.
- Added `packages/api/src/gateway-error-handlers.ts` and re-exported it from the API package entrypoint.
- Preserved HTTPException passthrough, structured internal-error responses, and bounded logging that reports only the error class/name.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-error-handlers.ts` did not exist.
- GREEN: Extracted `handleGatewayError` and `handleGatewayNotFound`, then wired `createKnowledgeGateway` to use them.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This will be implementation commit 9 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 1 more implementation commit.
