# S3-Compatible Object Storage Adapter

## What Changed

- Added `createS3ObjectStorageAdapter` in `@knowledge/adapters`.
- Added `@aws-sdk/client-s3` to the adapters package.
- Implemented the full `ObjectStorageAdapter` contract on top of S3-compatible commands:
  - `PutObjectCommand`
  - `GetObjectCommand`
  - `HeadObjectCommand`
  - `DeleteObjectCommand`
  - `ListObjectsV2Command`
  - `HeadBucketCommand`
- Added support for injected S3 clients so tests and future runtime wiring can provide MinIO, R2, or custom S3-compatible clients.
- Kept the existing memory object storage adapter unchanged for current skeleton defaults.

## Why

Sprint 1 requires a real object storage adapter surface for R2/MinIO-compatible deployments. The project can now target MinIO and Cloudflare R2 through the same S3-compatible adapter while keeping local tests independent from a running object storage service.

## TDD Notes

- RED: Extended `packages/adapters/src/object-storage.test.ts` to reference `createS3ObjectStorageAdapter`.
- The first run failed because the S3 adapter factory did not exist.
- GREEN: Added the S3-compatible implementation and SDK dependency.
- REFACTOR: Added body/error/default mapping tests to keep adapter coverage above the project threshold.

## Performance Notes

- `putObject` rejects payloads above `maxObjectBytes` before sending an S3 command.
- `listObjects` requires an explicit positive `limit` and uses S3 continuation cursors.
- `getObject` returns copied bytes so callers cannot mutate adapter-returned buffers.
- No real network integration test was added in this slice, avoiding external-service dependency in CI.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/object-storage.test.ts`: passed.
- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: 98.8% lines/statements, 95.07% branches, 100% functions.
- `pnpm --filter @knowledge/adapters typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `cargo test --workspace`: passed.

## Known Risks / Follow-Up

- Real MinIO/R2 runtime wiring is still pending.
- MinIO bucket bootstrap is still pending.
- Integration tests against a live MinIO container should be added once local service wiring is in place.
