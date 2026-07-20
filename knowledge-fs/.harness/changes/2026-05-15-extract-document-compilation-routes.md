# Extract Document Compilation Routes

## Summary

- Extracted document compilation job OpenAPI route definitions from `packages/api/src/index.ts` into `packages/api/src/document-compilation-routes.ts`.
- Preserved existing gateway handler wiring for job status lookup and cancellation.
- Added a code-health guardrail to keep these route definitions out of the gateway god file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `document-compilation-routes.ts` did not exist.
- GREEN: Added the route module, package re-export, gateway imports, and removed the inline route definitions.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 3 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 7 more implementation commits.
