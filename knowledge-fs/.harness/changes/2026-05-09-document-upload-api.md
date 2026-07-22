# Document Upload API

## What Changed

- Added authenticated `POST /knowledge-spaces/{id}/documents` upload support.
- Added bounded in-memory and database-backed `DocumentAssetRepository` implementations.
- Stored uploaded bytes through the platform object-storage adapter with tenant/space/document object-key isolation.
- Added OpenAPI coverage for the multipart upload route.

## Why

Sprint 2 needs the first document ingestion boundary on top of authenticated tenant-scoped KnowledgeSpace CRUD. This slice persists uploaded objects and creates pending `DocumentAsset` records without starting parsing, queueing, or external provider work.

## TDD Notes

- RED: Gateway tests first referenced the upload route and document-asset repositories before implementation.
- GREEN: Added upload request validation, object storage writes, SHA-256 calculation, pending asset creation, and database SQL wiring.
- REFACTOR: Kept upload buffering bounded by `maxUploadBytes` and added cleanup for object writes when asset persistence fails.

## Performance Notes

- Uploads are size checked before buffering; the current `Uint8Array` object-storage contract remains bounded by `maxUploadBytes`.
- The route performs one tenant-scoped KnowledgeSpace lookup before upload and one document-asset insert after object storage.
- Database-backed asset creation uses parameterized SQL and explicit `maxRows`.
- Default in-memory asset storage is capped by `maxAssets` to avoid unbounded retention.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
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

## Known Risks / Follow-Up

- This slice supports a single file per request only; batch upload and version overwrite behavior are deferred.
- Parser dispatch, job enqueueing, and Unstructured/native parser integration are deferred to ingestion iterations.
- Real production database driver wiring is still a separate runtime integration slice.
