# Bulk Document Upload API

## Summary

- Added `POST /knowledge-spaces/{id}/documents/bulk`.
- The route accepts bounded multipart uploads using the `files` field.
- Each accepted file becomes a pending `DocumentAsset` and a durable document compilation job.
- The response includes a generated `bulkJobId`, per-file queued job details, and per-document status URLs.

## Contract

- Requires `knowledge-spaces:write` or `knowledge-spaces:*`.
- Requires a configured `DocumentCompilationJobStateMachine`; otherwise returns `503`.
- Uses the authenticated subject tenant and verifies the tenant-scoped knowledge space before accepting files.
- Does not parse documents on the request path.

## Performance And Safety

- `maxBulkUploadFiles` defaults to `25`.
- `maxBulkUploadBytes` defaults to `maxUploadBytes * maxBulkUploadFiles`.
- Each file is still bounded by `maxUploadBytes`.
- The route reads and validates the full batch before object/asset/job writes, preventing partial writes from late size validation.
- On write/job failure, uploaded objects are cleaned up best-effort and created assets are marked `failed`.

## Tests

- Added red-first API coverage for the missing route.
- Covered two-file bulk upload, object writes, pending assets, queued compilation jobs, and OpenAPI path exposure.
- Covered too many files, missing files, per-file upload limit, total batch byte limit, missing durable job configuration, and invalid bulk bounds.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
