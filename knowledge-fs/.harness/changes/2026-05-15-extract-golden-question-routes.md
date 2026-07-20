# Extract GoldenQuestion Routes

## Summary

- Moved GoldenQuestion CRUD, annotation, and production bad-case OpenAPI route constants out of `packages/api/src/index.ts`.
- Added `packages/api/src/golden-question-routes.ts` and re-exported it from the API package entrypoint.
- Corrected the extracted production bad-case route to import `CreateProductionBadCaseSchema` from shared gateway route schemas.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `golden-question-routes.ts` did not exist.
- GREEN: Extracted the route constants and added a code-health guardrail that prevents these definitions from returning to `index.ts`.
- A focused typecheck caught an initial wrong schema import before commit; the route now uses the same schema source as the original gateway code.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This will be implementation commit 6 after review checkpoint `63eca78`.
- Next mandatory 10-commit review is due after 4 more implementation commits.
