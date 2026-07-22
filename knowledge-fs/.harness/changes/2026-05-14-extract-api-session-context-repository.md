# Extract API Session Context Repository

## Summary

- Continued R6 API decomposition by moving cache-backed query session context contracts, TTL handling, permission invalidation, bounded active resource lists, previous-query retention, cache key hashing, and clone helpers into `packages/api/src/session-context-repository.ts`.
- Preserved bounded cache entry size, bounded query bytes, and clone isolation for stored/query session context records.
- Added a code-health guardrail to keep session context repository implementation out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/session-context-repository.test.ts src/code-health.test.ts` failed because `session-context-repository.ts` did not exist.
- GREEN: implemented `packages/api/src/session-context-repository.ts`, re-exported it, and removed the cache-backed repository implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/session-context-repository.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 7 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
