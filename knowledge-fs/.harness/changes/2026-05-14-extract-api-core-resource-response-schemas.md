# Extract API Core Resource Response Schemas

## Summary

- Extracted KnowledgeSpace, GoldenQuestion, ParseArtifact, and AnswerTrace OpenAPI response schemas from `packages/api/src/index.ts` into `packages/api/src/core-resource-response-schemas.ts`.
- Re-exported the core resource response schema module from the API package root.
- Added direct schema tests and a code-health guardrail preventing these response schemas from drifting back into the gateway god file.

## TDD

- RED: added `core-resource-response-schemas.test.ts` and a code-health guardrail first; they failed because `core-resource-response-schemas.ts` did not exist.
- GREEN: moved the OpenAPI response schema wrappers, imported them from the gateway, re-exported the module, and reran focused tests.

## Performance Notes

- This slice is schema-only and introduces no I/O, database access, queue work, cache access, or provider calls.
- Upload ingestion still uses the core `ParseArtifactSchema` directly for persisted artifact validation; only the response wrapper moved.
- Route behavior, pagination, tenant scoping, and repository access paths are unchanged.

## Verification

- `pnpm --filter @knowledge/api test -- src/core-resource-response-schemas.test.ts src/code-health.test.ts`
- Full verification is run before commit.

## Review Cadence

- This is implementation commit 10 after review checkpoint `9042d56`.
- After this commit is pushed, feature work must pause for the mandatory 10-commit health review before continuing.
