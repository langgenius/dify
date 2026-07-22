# Durable Local Migration Bootstrap

## Summary

- Completed DLR.3 from the Durable Local Runtime Track.
- Added `pnpm local:db:migrate`, which loads `.env` when present and applies checked-in database migrations through the Node PostgreSQL adapter.
- Added an API app migration entrypoint that reuses the existing deterministic `runDatabaseMigrations()` implementation.
- Updated local docs so source-run users apply migrations before running the API against database-backed repositories.

## TDD Notes

- Red: API app tests required `runApiDatabaseMigrations()`, the root `local:db:migrate` script, and README documentation; the suite failed because `./migrate` did not exist.
- Green: added the migrate entrypoint, root script, and local docs.

## Performance Notes

- The command reuses the existing migration runner, which reads bounded migration records with explicit `maxRows`.
- Migrations run once and record applied ids in `schema_migrations`; repeated runs should be no-op after the select.
- The adapter database connection is closed after success or failure.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api-app test -- src/migrate.test.ts`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm compose:middleware:config`
  - `git diff --check`
