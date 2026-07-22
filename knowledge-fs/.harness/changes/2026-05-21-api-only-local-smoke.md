# API-Only Local Smoke

## Summary

- Added `pnpm local:happy-path:api` for source-run API validation without requiring the Admin dev server.
- Added `LOCAL_SMOKE_SKIP_ADMIN_BFF=1` handling in the local smoke script.
- Kept default `pnpm local:happy-path` behavior focused on the full Admin BFF plus API local loop.

## TDD

- Added failing assertions first for the missing root script, missing `LOCAL_SMOKE_SKIP_ADMIN_BFF` branch, and missing docs.
- Implemented the API-only path after the red test confirmed the gap.

## Performance And Safety

- The API-only path reuses the same bounded JSON/SSE readers and direct API upload route.
- The default smoke remains stronger because it still checks Admin BFF health and upload proxy behavior.
- No new database reads, queues, or polling loops were added.

## Verification

- Passed: `node --test scripts/local-happy-path-smoke.test.mjs`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 1 after review checkpoint `563f24c`.
