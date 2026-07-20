# API Database Row Utilities Extraction

## Summary

- Continued R6 by extracting low-level database row column readers from the API gateway file.
- Added focused tests for required/optional string and number column behavior.

## Changes

- Added `packages/api/src/database-row-utils.ts`.
- Moved `stringColumn`, `optionalStringColumn`, `numberColumn`, and `optionalNumberColumn` out of `packages/api/src/index.ts`.
- Exported the utility module from `@knowledge/api`.
- Added a code-health guardrail so DB row column helpers do not drift back into the gateway file.

## Verification

- `pnpm --filter @knowledge/api test -- src/database-row-utils.test.ts src/code-health.test.ts`
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

- R6 remains open for broader gateway decomposition; this slice removes another repeated low-level helper cluster from `index.ts`.
