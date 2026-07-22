# Object Storage Runtime Wiring

## What Changed

- Extended the Node platform factory with runtime object storage configuration:
  - Complete `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY` env selects the S3-compatible adapter.
  - Missing MinIO configuration keeps the bounded memory adapter fallback.
  - Optional injected S3 client supports tests without real network calls.
- Extended the Cloudflare platform factory with R2-compatible configuration:
  - Complete `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` env selects the R2 S3-compatible adapter.
  - Missing R2 configuration keeps the bounded memory adapter fallback.
- Added a one-shot `minio-bootstrap` compose service that creates `${MINIO_BUCKET:-knowledge-fs}`.
- Updated the API compose dependency so app startup waits for `minio-bootstrap` to complete successfully.
- Updated `.env.example`, `pnpm dev:infra`, and `infra/local/README.md` for MinIO/R2 runtime wiring.
- Made API gateway tests pass an explicit empty env so unit tests remain independent from developer machine object-storage credentials.

## Why

Sprint 1 needs the S3-compatible object storage adapter to be reachable from real platform factories while preserving simple local and CI defaults. This keeps no-credential environments on memory storage, but lets the local compose API switch to MinIO when the provided env is present.

## TDD Notes

- RED: Added platform factory tests proving complete MinIO/R2 env should route object storage through an injected fake S3 client.
- The first test run failed because both factories still returned memory-backed object storage.
- GREEN: Wired Node and Cloudflare factories to create configured S3 clients when env is complete.
- REFACTOR: Kept incomplete-env fallback tests explicit and isolated gateway tests from ambient shell env.

## Performance Notes

- Runtime wiring preserves the existing S3 adapter guardrails: bounded object size, explicit list limits, continuation cursors, and byte-copy isolation.
- Factory tests use injected fake clients, so they do not perform network calls or depend on external services.
- The API now waits for bucket bootstrap completion, avoiding startup retries or repeated failed object-storage calls caused by a missing bucket.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/adapters.test.ts`: passed.
- `pnpm check`: passed.
  - `packages/adapters`: 96.82% lines/statements, 96.12% branches, 100% functions.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.

## Known Risks / Follow-Up

- This slice validates compose rendering but does not start a live MinIO container.
- Live MinIO integration tests should be added once the project is ready to depend on local container startup in CI.
- Cloudflare Workers binding-specific configuration can be refined later; this slice uses explicit R2 S3-compatible env keys.
