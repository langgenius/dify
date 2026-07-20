# Extract API KnowledgeSpace GoldenQuestion Schemas

## Summary

- Extracted KnowledgeSpace and GoldenQuestion request, params, and list query schemas from `packages/api/src/index.ts` into `packages/api/src/knowledge-space-golden-question-schemas.ts`.
- Re-exported the schema module from the API package root and kept gateway route wiring behavior unchanged.
- Added direct schema tests and a code-health guardrail preventing these request schemas from drifting back into the gateway god file.

## TDD

- RED: added `knowledge-space-golden-question-schemas.test.ts` and a code-health guardrail first; they failed because `knowledge-space-golden-question-schemas.ts` did not exist.
- GREEN: moved the schemas, imported them from the gateway, re-exported the module, and reran focused tests plus typecheck and lint.

## Performance Notes

- This slice is request-schema-only and introduces no I/O, database access, object storage access, queue work, cache access, or provider calls.
- Existing list query behavior remains bounded by explicit caller-provided minimum limits and existing repository max-list-limit enforcement.
- Golden question annotation evidence remains bounded at 50 entries.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-space-golden-question-schemas.test.ts src/code-health.test.ts`
- Full verification is run before commit.

## Review Cadence

- This is implementation commit 1 after review checkpoint `207c4f3`.
- The next mandatory health review is due after 9 more implementation commits.
