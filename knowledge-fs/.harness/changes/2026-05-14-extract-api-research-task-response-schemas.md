# Extract API Research Task Response Schemas

## Summary

- Extracted research task job, partial-result list, and dry-run plan response schemas from `packages/api/src/index.ts` into `packages/api/src/research-task-response-schemas.ts`.
- Re-exported the research response schema module from the API package root.
- Added direct schema tests and a code-health guardrail preventing research response schemas from drifting back into the gateway god file.

## TDD

- RED: added `research-task-response-schemas.test.ts` and a code-health guardrail first; they failed because `research-task-response-schemas.ts` did not exist.
- GREEN: moved the schemas, imported them from the gateway, re-exported the module, and reran focused tests plus API typecheck and lint.

## Performance Notes

- This slice is schema-only and introduces no I/O, database access, cache access, queue work, or provider calls.
- Research dry-run bounds, job lifecycle semantics, and partial result pagination behavior are unchanged.
- Partial-result response validation still references the shared core `EvidenceBundleSchema`, avoiding divergent evidence contracts.

## Verification

- `pnpm --filter @knowledge/api test -- src/research-task-response-schemas.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- Remaining full verification is run before commit.

## Review Cadence

- This is implementation commit 8 after review checkpoint `9042d56`.
- The next mandatory health review is due after 2 more implementation commits.
- Temporary task/progress documents are absent after the earlier cleanup, so this checkpoint is recorded in `.harness/changes` and the remediation iteration plan.
