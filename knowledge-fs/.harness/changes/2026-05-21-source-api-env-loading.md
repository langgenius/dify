# Source API Env Loading

## Summary

- Completed DLR.4 from the Durable Local Runtime Track.
- Updated the source API dev script so `pnpm dev:api` loads the root `.env` before starting `apps/api/src/server.ts`.
- Documented that source-run API, migration, MinIO, and local auth settings share the same `.env` values.

## TDD Notes

- Red: API app script tests expected `--env-file-if-exists=../../.env`, `--import tsx`, and `--watch src/server.ts`; the existing script was only `tsx watch src/server.ts`.
- Green: changed the script to Node's `.env` loader plus `tsx` import and watch mode.

## Performance Notes

- No runtime request path changed.
- Loading `.env` happens once at dev process startup and does not add request-time IO.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
