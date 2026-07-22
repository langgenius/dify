# Extract API Research Task Request Schemas

## Summary

- Extracted research task create, dry-run planning, job params, partial-result query, and progress query schemas from `packages/api/src/index.ts` into `packages/api/src/research-task-request-schemas.ts`.
- Moved the related `z.infer` route helper types into the same module and re-exported it from the API package root.
- Added direct schema tests and a code-health guardrail preventing these request schemas from drifting back into the gateway god file.

## TDD

- RED: added `research-task-request-schemas.test.ts` and a code-health guardrail first; they failed because `research-task-request-schemas.ts` did not exist.
- GREEN: moved the schemas and inferred types, imported them from the gateway, re-exported the module, and reran focused tests plus typecheck and lint.

## Performance Notes

- This slice is request-schema-only and introduces no I/O, database access, object storage access, queue work, cache access, or provider calls.
- Research task fanout remains bounded through `topK <= 50`.
- Partial result and progress list queries keep explicit `limit` bounds with default `25` and max `100`.

## Verification

- `pnpm --filter @knowledge/api test -- src/research-task-request-schemas.test.ts src/code-health.test.ts`
- Full verification is run before commit.

## Review Cadence

- This is implementation commit 2 after review checkpoint `207c4f3`.
- The next mandatory health review is due after 8 more implementation commits.
