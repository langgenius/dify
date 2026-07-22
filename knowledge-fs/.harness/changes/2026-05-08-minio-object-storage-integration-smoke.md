# MinIO Object Storage Integration Smoke

## What Changed

- Added a live MinIO object-storage integration smoke test for the Node platform adapter.
- Added root `pnpm test:minio` and package-level adapter `test:minio` scripts.
- Documented the local command flow in `infra/local/README.md`.

## Why

The object-storage adapter now has fake-client contract coverage and runtime wiring. A separate live smoke test verifies the same adapter path against a real S3-compatible MinIO endpoint without making normal CI depend on local containers.

## TDD Notes

- RED: `pnpm test:minio` failed because no script existed.
- GREEN: Added an explicit integration script and a guarded integration test that only runs live when `RUN_MINIO_INTEGRATION=1`.

## Performance Notes

- The smoke test uses a single bounded object and explicit list limit.
- The live test is opt-in and is not part of default `pnpm check`, avoiding container startup overhead in normal CI.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/object-storage.integration.test.ts`: passed with the live test skipped when `RUN_MINIO_INTEGRATION` is unset.
- `docker compose up -d minio minio-bootstrap`: not run successfully because the local Docker daemon is unavailable in this environment.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- Run `docker compose up -d minio minio-bootstrap && pnpm test:minio` in an environment with Docker daemon available to exercise the live path.
