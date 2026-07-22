# Extract Gateway OpenAPI Contracts

## Summary

- Moved `KnowledgeGatewayEnv`, `UnauthorizedResponse`, and `ForbiddenResponse` from the gateway entrypoint into `packages/api/src/gateway-openapi-contracts.ts`.
- Re-exported the shared OpenAPI contract module from the API package entrypoint.
- Added a code-health guardrail so route-level auth response specs and Hono env typing stay outside `index.ts`.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-openapi-contracts.ts` did not exist.
- GREEN: Added the extracted contract module, updated imports, and tightened the guardrail to allow the expected type-only import.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`

## Review Cadence

- This will be implementation commit 4 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 6 more implementation commits.
