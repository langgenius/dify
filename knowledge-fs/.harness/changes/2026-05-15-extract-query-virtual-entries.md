# Extract Query Virtual Entry Helpers

## Summary

- Continued the API god-file decomposition by moving query virtual FS helpers out of `packages/api/src/index.ts`.
- Added `packages/api/src/query-virtual-entries.ts` for evidence bundle extraction, `/queries/...` virtual entries, production bad-case golden question input assembly, and bounded virtual pagination.
- Added direct tests and a code-health guardrail to keep query virtual helper logic outside the gateway file.

## TDD Notes

- RED: added `query-virtual-entries.test.ts` and a `code-health.test.ts` guardrail before the new module existed.
- GREEN: implemented the module, exported it from the API package, and rewired `index.ts` to import the helpers.

## Performance And Safety Notes

- Preserved explicit cursor validation for virtual query pagination.
- Preserved bounded production bad-case evidence context projection: max 20 evidence items and max 20 missing evidence items.
- Kept clone isolation for evidence bundle extraction and metadata projection.
- No new database, object storage, parser, or network behavior was introduced.

## Verification

- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/query-virtual-entries.test.ts src/code-health.test.ts`
- Full verification to run before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice is implementation commit 8 after review checkpoint `207c4f3`.
- Next mandatory 10-commit health review is due after 2 more implementation commits.
