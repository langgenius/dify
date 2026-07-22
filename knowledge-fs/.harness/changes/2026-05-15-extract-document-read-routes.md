# Extract Document Read Routes

## Summary

- Moved document asset and parse artifact read OpenAPI route constants out of `packages/api/src/index.ts`.
- Added `packages/api/src/document-read-routes.ts` and re-exported it from the API package entrypoint.
- Kept route handlers in the gateway while separating static document read route definitions.

## TDD Notes

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `document-read-routes.ts` did not exist.
- GREEN: Extracted `getDocumentAssetRoute` and `getParseArtifactRoute`, then wired the gateway to import them.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`

## Review Cadence

- This will be implementation commit 1 after review checkpoint `ba4d2c9`.
- Next mandatory 10-commit review is due after 9 more implementation commits.
