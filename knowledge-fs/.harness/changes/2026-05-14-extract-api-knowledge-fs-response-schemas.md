# Extract API KnowledgeFS Response Schemas

## Summary

- Extracted KnowledgeFS OpenAPI response schemas from `packages/api/src/index.ts` into `packages/api/src/knowledge-fs-response-schemas.ts`.
- Moved `SemanticDiffSummarySchema` and semantic diff response bounds with the diff response schema so provider output validation and OpenAPI responses share one contract.
- Re-exported the schema module from the API package root and added a code-health guardrail to keep these schemas out of the gateway god file.

## TDD

- RED: added `knowledge-fs-response-schemas.test.ts` and a code-health guardrail first; they failed because the schema module did not exist.
- GREEN: moved schemas and bounds, imported them from the gateway, re-exported the module, and reran focused schema/code-health tests plus API typecheck.

## Performance Notes

- This slice is schema-only and introduces no I/O, database access, cache access, queue work, or additional parsing passes.
- Semantic diff metadata keeps the existing `jsonByteLength` bound of 16 KiB.
- KnowledgeFS list/tree/grep/diff/cat/stat response bounds and route-level pagination limits are unchanged.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-response-schemas.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- Remaining full verification is run before commit.

## Review Cadence

- This is implementation commit 6 after review checkpoint `9042d56`.
- The next mandatory health review is due after 4 more implementation commits.
- Temporary task/progress documents are absent after the earlier cleanup, so this checkpoint is recorded in `.harness/changes` and the remediation iteration plan.
