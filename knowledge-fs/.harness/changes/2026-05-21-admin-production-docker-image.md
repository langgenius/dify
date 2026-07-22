# Admin Production Docker Image

## Summary

- Added `apps/admin/Dockerfile` for a production Next.js standalone Admin image.
- Updated the full `compose.yaml` app profile to run `knowledge-fs-admin:local` instead of a bind-mounted development server.
- Added `pnpm docker:admin:build` and wired the Admin image build into GitHub Actions.

## TDD

- RED: `test -f apps/admin/Dockerfile && pnpm docker:admin:build` failed because the Dockerfile and build script were absent.
- GREEN: Added Dockerfile contract tests, updated Compose app-profile tests, and updated workflow assertions.

## Performance And Safety

- The production image copies Next standalone output and static assets only, avoiding a repository bind mount in the app profile.
- The Admin container remains a thin UI/BFF boundary and points browser traffic at the local API port.
- The middleware-only Compose file remains the source-run option when API/Admin should run from host code.

## Verification

- Passed: `pnpm --filter @knowledge/admin test -- admin-dockerfile.test.ts`
- Passed: `pnpm compose:apps:test`
- Passed: `pnpm ci:workflow:test`
- Passed: `pnpm docker:admin:build`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `pnpm compose:config`
- Passed: `docker compose --profile apps config`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 7 after review checkpoint `563f24c`.
