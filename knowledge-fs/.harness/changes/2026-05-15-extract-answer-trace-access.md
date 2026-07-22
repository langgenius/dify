# Extract AnswerTrace Tenant Access Helper

## Summary

- Continued R6 API decomposition by moving tenant-scoped `AnswerTrace` lookup out of `packages/api/src/index.ts`.
- Added `packages/api/src/answer-trace-access.ts` as the reusable boundary for hiding missing and cross-tenant traces behind `null`.
- Kept gateway behavior unchanged by re-exporting and importing the helper from the API entrypoint.

## TDD Notes

- RED: added direct access tests and a code-health guardrail before the module existed.
- GREEN: implemented the module and removed `getTenantScopedAnswerTrace` from the gateway file.

## Performance And Safety

- Preserved the two-step lookup: trace by id, then tenant-scoped KnowledgeSpace verification.
- No unbounded list/read path was introduced.
- Cross-tenant traces remain indistinguishable from missing traces.

## Verification

- `pnpm --filter @knowledge/api test -- src/answer-trace-access.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`

## Review Cadence

- This slice is implementation commit 1 after review checkpoint `63eca78`.
- The next mandatory 10-commit health review is due after 9 more implementation commits.
