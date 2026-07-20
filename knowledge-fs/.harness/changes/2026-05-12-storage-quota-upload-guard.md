# Storage Quota Upload Guard

## What Changed

- Added a `StorageQuotaRepository` contract and `createStaticStorageQuotaRepository()` for injectable upload quota policy.
- Extended `DocumentAssetRepository` with `getStorageUsage({ knowledgeSpaceId })`.
- Added in-memory storage usage calculation over the already bounded document asset map.
- Added database-backed usage aggregation with a single parameterized `COUNT(*)` / `SUM(size_bytes)` query and `maxRows: 1`.
- Added single and bulk upload quota checks before object storage writes and document asset creation.
- Quota violations return `413 { error: "Storage quota exceeded" }`.

## Why

Sprint 12 requires storage quotas so uploads fail clearly before raw document storage grows beyond configured bounds. The API must avoid list-scanning documents or writing raw objects that then need cleanup when quota is already exceeded.

## Performance Notes

- Database usage reads are one aggregate query scoped by `knowledge_space_id`; no document list pagination loop or N+1 path is introduced.
- Upload quota checks run after existing bounded request-body validation and before object storage writes.
- In-memory usage scans only the bounded fallback repository (`maxAssets`), which is acceptable for local/dev fallback and tests.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createStaticStorageQuotaRepository` and `repository.getStorageUsage` did not exist.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- Quota configuration is currently injectable/static; durable quota policy APIs and tenant-wide quota aggregation can be added in a later slice if product requirements need admin-managed limits.
