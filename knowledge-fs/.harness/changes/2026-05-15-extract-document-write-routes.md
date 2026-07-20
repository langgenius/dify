# Extract Document Write Routes

## Summary

- Extracted document upload and bulk document route OpenAPI definitions from `packages/api/src/index.ts` into `packages/api/src/document-write-routes.ts`.
- Kept the existing gateway handler wiring unchanged so upload, bulk upload, delete, and reindex behavior stays stable.
- Added a code-health guardrail preventing these route definitions from returning to the gateway god file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `document-write-routes.ts` did not exist.
- GREEN: Added the focused route module, re-exported it from the API package, imported the route constants into the gateway entrypoint, and removed the inline definitions.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This is implementation commit 2 after review checkpoint `ba4d2c9`.
- Next mandatory project health review is due after 8 more implementation commits.
