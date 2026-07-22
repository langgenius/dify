# Extract API SSE Event Formatters

## Summary

- Continued R6 API decomposition by moving query and research-task SSE frame formatting from `packages/api/src/index.ts` into `packages/api/src/sse-events.ts`.
- Added direct unit tests for answer delta/done frames, research progress frames, and common error-frame formatting.
- Added a code-health guardrail to keep SSE formatting out of the gateway file.

## Why

- SSE formatting is a pure, cohesive boundary. Extracting it reduces gateway file responsibilities without changing route behavior.
- Direct tests make the event wire format explicit and help avoid accidental leakage of request-only fields such as tenant ids or credentials.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/sse-events.test.ts src/code-health.test.ts` failed because `sse-events.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/sse-events.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Risks And Follow-Up

- This is a mechanical extraction of existing behavior plus focused tests.
- Continue R6 by moving additional cohesive helpers out of `packages/api/src/index.ts`, preferring pure utilities before repository-heavy code.
