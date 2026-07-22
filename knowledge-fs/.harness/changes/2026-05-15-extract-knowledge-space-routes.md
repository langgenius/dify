# Extract KnowledgeSpace Routes

## Summary

- Moved KnowledgeSpace CRUD OpenAPI route constants out of `packages/api/src/index.ts`.
- Added `packages/api/src/knowledge-space-routes.ts` and re-exported it from the API package entrypoint.
- Kept handler registration in the gateway entrypoint while moving route schemas to the resource-specific module.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `knowledge-space-routes.ts` did not exist.
- GREEN: Extracted the route constants and added a code-health guardrail that prevents these definitions from returning to `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`

## Review Cadence

- This will be implementation commit 5 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 5 more implementation commits.
