# Extract API OpenAPI Handler Utilities

## Summary

- Extracted loose OpenAPI context typing and handler cast helpers from `packages/api/src/index.ts`.
- Added `packages/api/src/openapi-handler-utils.ts` with tests proving the helpers do not wrap or mutate runtime objects.
- Added a code-health guardrail so OpenAPI cast helpers do not drift back into the gateway file.

## Why

- This continues R6 module decomposition from `docs/code-review-issues.md`.
- Keeping these casts in a tiny module makes the Hono/OpenAPI type escape hatch explicit while preserving zero additional runtime work in route handlers.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/openapi-handler-utils.test.ts src/code-health.test.ts` failed before `openapi-handler-utils.ts` existed.
- GREEN focused: `pnpm --filter @knowledge/api test -- src/openapi-handler-utils.test.ts src/code-health.test.ts src/gateway.test.ts`

## Notes

- The temporary progress documents were previously removed after iteration-plan completion, so this permanent change summary records the slice.
- Review cadence restarted after checkpoint `f6ceb51`; this is implementation commit 4 after that checkpoint.
