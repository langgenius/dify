# App Compose Contract Guardrail

## Summary

- Added `pnpm compose:apps:test` to statically guard the full `compose.yaml` app profile.
- The guardrail checks API image build wiring, middleware readiness dependencies, service-local API URLs, and the Admin source-run BFF base URL.
- Added the contract test to `pnpm check` and GitHub Actions before Compose config rendering.

## TDD

- RED: `pnpm compose:apps:test` failed because the script did not exist.
- GREEN: Added `scripts/compose-apps.test.mjs`, wired the package script, and updated workflow assertions.

## Performance And Safety

- The test does not start containers or make network calls.
- The app profile continues to require PostgreSQL health and MinIO bucket bootstrap completion before API startup.
- The API container uses service-local middleware URLs, avoiding host-network assumptions inside Docker.

## Verification

- Passed: `pnpm compose:apps:test`
- Passed: `pnpm ci:workflow:test`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `pnpm compose:config`
- Passed: `docker compose --profile apps config`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 6 after review checkpoint `563f24c`.
