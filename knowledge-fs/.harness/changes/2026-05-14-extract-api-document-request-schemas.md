# Extract API Document Request Schemas

## Summary

- Extracted document upload, document asset, parse artifact, compilation job, bulk upload, bulk delete, and bulk reindex request schemas from `packages/api/src/index.ts` into `packages/api/src/document-request-schemas.ts`.
- Reused the existing KnowledgeSpace params schema for single and bulk document upload routes.
- Added direct schema tests and a code-health guardrail preventing document request schemas from drifting back into the gateway god file.

## TDD

- RED: added `document-request-schemas.test.ts` and a code-health guardrail first; they failed because `document-request-schemas.ts` did not exist.
- GREEN: moved the schemas, preserved the bulk reindex either/or refine check, imported them from the gateway, and reran focused tests plus typecheck and lint.

## Performance Notes

- This slice is request-schema-only and introduces no I/O, database access, object storage access, queue work, cache access, or provider calls.
- Bulk delete still requires at least one document id.
- Bulk reindex still rejects ambiguous unbounded bodies by requiring exactly one of `all=true` or explicit `documentIds`.

## Verification

- `pnpm --filter @knowledge/api test -- src/document-request-schemas.test.ts src/code-health.test.ts`
- Full verification is run before commit.

## Review Cadence

- This is implementation commit 3 after review checkpoint `207c4f3`.
- The next mandatory health review is due after 7 more implementation commits.
