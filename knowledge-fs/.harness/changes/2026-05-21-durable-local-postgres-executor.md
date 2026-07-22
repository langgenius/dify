# Durable Local PostgreSQL Executor

## Summary

- Started DLR.1 from the Durable Local Runtime Track.
- Added a pool-backed PostgreSQL executor for the Node adapter.
- `createNodePlatformAdapter()` now uses the executor when `DATABASE_URL` is configured or a test pool is injected.
- Updated `.env.example` and local docs so source-run API can opt into PostgreSQL and MinIO instead of silently using only memory fallbacks.

## TDD Notes

- Red: adapter tests imported `createPostgresDatabaseExecutor()` and expected `DATABASE_URL` to wire pool-backed execution; the suite failed because `./postgres` did not exist.
- Green: added the executor, health probe, pool close hook, Node adapter wiring, and docs/env updates.

## Performance Notes

- SQL execution keeps parameter arrays separate from SQL text.
- Health uses a single bounded `SELECT 1;` probe.
- No repository scan or list behavior was added; existing `DatabaseAdapter.execute()` still rejects unbounded reads through `maxRows`.
- The pool max defaults to 10 and can be bounded through `POSTGRES_POOL_MAX`.

## Verification

- Passed:
  - `pnpm --filter @knowledge/adapters test -- src/database.test.ts`
  - `pnpm --filter @knowledge/adapters typecheck`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm compose:middleware:config`
  - `git diff --check`
