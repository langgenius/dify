# Extract API Gateway SSE Responses

## Summary

- Extracted query generation and research task progress SSE response builders from `packages/api/src/index.ts` into `packages/api/src/gateway-sse-responses.ts`.
- Moved `QueryGenerator` and query generation input/event contracts with the streaming boundary.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing SSE response builders from drifting back into the gateway.

## Why

- Continues R6 code review remediation by separating streaming response construction from route registration.
- Keeps SSE framing helpers and stream lifecycle logic in a small module that does not depend on the gateway entrypoint.

## TDD

- RED: added a code-health guardrail first; it failed because `gateway-sse-responses.ts` did not exist.
- GREEN: extracted query/progress SSE builders and contracts, then reran focused gateway/code-health tests.

## Performance Notes

- Preserved streaming behavior without buffering generated answer chunks or progress events.
- Research task progress streaming remains bounded by the requested `limit`; backlog is sent first and live subscription stops after the same limit.
- No new database or object storage calls were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 10 after review checkpoint `0e46d78`; a mandatory 10-commit health review must run immediately after this commit is pushed.
