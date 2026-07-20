# API Database SQL Utilities Extraction

## Summary

- Continued R6 by extracting SQL rendering helpers from the API gateway file.
- Aligned API identifier quoting with the escaped dialect behavior already used by lower-level database adapters.

## Changes

- Added `packages/api/src/database-sql-utils.ts`.
- Moved `quoteDatabaseIdentifier`, `qualifiedDatabaseIdentifier`, `databasePlaceholder`, `jsonInsertPlaceholder`, and `indexProjectionInsertPlaceholder` out of `packages/api/src/index.ts`.
- Exported the SQL utility module from `@knowledge/api`.
- Added regression tests for identifier escaping, placeholder rendering, JSON casts, vector casts, and FTS placeholders.
- Added a code-health guardrail to prevent these helpers from drifting back into the gateway file.

## Verification

- `pnpm --filter @knowledge/api test -- src/database-sql-utils.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Notes

- This is a decomposition slice with a small safety fix: embedded double quotes/backticks in identifiers are now escaped before rendering.
