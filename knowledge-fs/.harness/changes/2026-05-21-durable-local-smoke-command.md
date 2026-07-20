# Durable Local Smoke Command

## Summary

- Added `pnpm local:happy-path:durable` as an explicit source-run durable smoke command.
- Added `LOCAL_SMOKE_EXPECT_DURABLE=1` handling to the local smoke script.
- Updated local docs and the iteration plan so users can distinguish memory fallback, API-only smoke, and durable middleware-backed smoke.

## TDD

- Added failing script/doc assertions first for the missing durable command and missing durable env checks.
- Implemented the command and smoke validation after the red test confirmed the gap.

## Performance And Safety

- Durable mode fails fast unless `DATABASE_URL` and MinIO env are present.
- Durable mode checks health for database and object storage before upload/query work begins.
- No new data-plane reads, unbounded loops, or extra database round-trips were added to the app runtime.

## Verification

- Passed: `node --test scripts/local-happy-path-smoke.test.mjs`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 2 after review checkpoint `563f24c`.
