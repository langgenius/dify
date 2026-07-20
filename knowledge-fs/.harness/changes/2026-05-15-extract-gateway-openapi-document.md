# Extract Gateway OpenAPI Document

## Summary

- Moved static OpenAPI document metadata out of `packages/api/src/index.ts`.
- Added `packages/api/src/gateway-openapi-document.ts` and re-exported it from the API package entrypoint.
- Updated `createKnowledgeGateway` to register the shared document constant at `/openapi.json`.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-openapi-document.ts` did not exist.
- GREEN: Added the metadata module and a code-health guardrail that keeps title/version metadata out of the gateway god file.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This will be implementation commit 8 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 2 more implementation commits.
