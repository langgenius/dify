# Middleware-Only Local Compose

## Summary

- Added `compose.middleware.yaml` for local middleware services only: PostgreSQL, MinIO, MinIO bucket bootstrap, and Unstructured.
- Changed `pnpm dev:infra` to use the middleware-only Compose file so API and Admin can run from local source code.
- Added `compose:middleware:config` and `compose:middleware:test` scripts.
- Wired `compose:middleware:test` into `pnpm check` to prevent accidentally adding `api` or `admin` back into the middleware-only file.

## TDD Notes

- Red: `pnpm compose:middleware:test` failed because `compose.middleware.yaml` did not exist.
- Green: added the middleware-only Compose file and assertion test.

## Verification

- Passed:
  - `pnpm compose:middleware:test`
  - `pnpm compose:middleware:config`
  - `pnpm lint`
  - `pnpm check`
  - `git diff --check`
