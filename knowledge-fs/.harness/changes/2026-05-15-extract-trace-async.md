# Extract Async Trace Span Wrapper

## Summary

- Continued R6 API decomposition by moving the route-local async trace span wrapper out of `packages/api/src/index.ts`.
- Added `packages/api/src/trace-async.ts` for reusable traced async execution.
- Kept gateway behavior unchanged by re-exporting and importing the helper from the API entrypoint.

## TDD Notes

- RED: added focused trace wrapper tests and a code-health guardrail before the module existed.
- GREEN: implemented the helper and removed the local `traceAsync` function from the gateway file.

## Performance And Safety

- No new I/O, database, object-storage, or queue paths were introduced.
- Error trace attributes remain bounded to `errorClass`; raw stack traces, JWTs, payloads, and file bytes are not recorded.
- The helper rethrows the original error after marking the span failed.

## Verification

- `pnpm --filter @knowledge/api test -- src/trace-async.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`

## Review Cadence

- This slice is implementation commit 2 after review checkpoint `63eca78`.
- The next mandatory 10-commit health review is due after 8 more implementation commits.
