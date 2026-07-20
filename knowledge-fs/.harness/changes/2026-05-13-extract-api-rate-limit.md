# Extract API Rate Limit Boundary

## Summary

- Continued R6 API decomposition by moving rate limiter contracts, noop/in-memory implementations, capacity error, and rate-limit middleware into `packages/api/src/rate-limit.ts`.
- Added direct unit tests for noop behavior, bounded per-key windows, expired-window pruning, and max-key capacity protection.
- Added a code-health guardrail so limiter implementations and middleware do not move back into `packages/api/src/index.ts`.

## Why

- Rate limiting is a cohesive cross-cutting boundary with explicit memory-capacity behavior. Keeping it separate makes performance guardrails easier to inspect.
- This removes another stateful implementation from the gateway god file while preserving the existing injected `RateLimiter` contract.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/rate-limit.test.ts src/code-health.test.ts` failed because `rate-limit.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/rate-limit.test.ts src/code-health.test.ts src/gateway.test.ts`
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

- The in-memory limiter remains bounded by `maxKeys`; production deployments should still prefer an external/shared limiter when multiple API instances are active.
- Existing gateway tests continue covering protected route 429 behavior and response headers.
