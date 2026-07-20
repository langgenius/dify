# Extract Gateway App Shell

## Summary

- Moved `OpenAPIHono` construction and shared handler installation out of `packages/api/src/index.ts`.
- Added `packages/api/src/gateway-app.ts` with `createKnowledgeGatewayApp()`.
- Kept `createKnowledgeGateway` focused on dependency wiring and route registration.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-app.ts` did not exist.
- GREEN: Added the app shell module and wired `createKnowledgeGateway` through it.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This will be implementation commit 10 after review checkpoint `63eca78`.
- A mandatory 10-commit health review must run immediately after this commit is pushed before any further feature/decomposition work.
