# 2026-05-08 Object Storage Adapter Contract

## Summary

- Expanded the core `ObjectStorageAdapter` contract beyond health checks.
- Added a bounded in-memory object storage adapter for local/standalone tests and skeleton use.
- Wired Cloudflare and Node platform adapter skeletons to the object storage implementation.
- Added TDD coverage for object write/read/head/delete, bounded listing, pagination cursors, and max object size rejection.

## Files Added Or Updated

- `packages/core/src/platform-adapter.ts`
- `packages/core/src/platform-adapter.test.ts`
- `packages/adapters/src/object-storage.ts`
- `packages/adapters/src/object-storage.test.ts`
- `packages/adapters/src/cloudflare.ts`
- `packages/adapters/src/node.ts`
- `packages/adapters/src/index.ts`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/2026-05-08-object-storage-adapter-contract.md`

## Why

Sprint 1 requires an object storage adapter before document upload and ingestion can safely store immutable document assets.

The implementation keeps performance constraints visible:

- Object writes enforce a configured `maxObjectBytes` cap.
- Object listing requires an explicit positive limit.
- Pagination uses stable key cursors.
- Reads return byte copies so callers cannot mutate adapter-held state.

## TDD Notes

- RED: Added `packages/adapters/src/object-storage.test.ts`, then ran `pnpm --filter @knowledge/adapters test`.
- The test failed because `./object-storage` did not exist.
- GREEN: Added the object storage contract and memory adapter implementation.
- REFACTOR: Fixed strict optional typing, added unbounded-list rejection coverage, and ran formatting.

## Verification

- `pnpm --filter @knowledge/adapters test`: passed.
- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: 100% lines, statements, branches, and functions.
- `pnpm --filter @knowledge/core test:coverage`: passed.
  - `packages/core`: 100% lines, statements, branches, and functions.

## Known Risks And Follow-Up

- This is a bounded memory adapter and contract skeleton, not the final R2/S3 client implementation.
- Future R2/S3 adapters must preserve the same bounded listing semantics and avoid loading unbounded object lists into memory.
