# 2026-05-08 Bounded Cache Adapter

## Summary

- Expanded the core `CacheAdapter` contract beyond health checks.
- Added a bounded in-memory cache adapter.
- Wired Node and Cloudflare platform adapter skeletons to the cache contract.
- Added TDD coverage for set/get/delete, TTL expiry, stats cleanup, max entry bounds, oldest-entry eviction, and byte-copy isolation.

## Files Added Or Updated

- `packages/core/src/platform-adapter.ts`
- `packages/core/src/platform-adapter.test.ts`
- `packages/adapters/src/cache.ts`
- `packages/adapters/src/cache.test.ts`
- `packages/adapters/src/cloudflare.ts`
- `packages/adapters/src/node.ts`
- `packages/adapters/src/index.ts`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/2026-05-08-bounded-cache-adapter.md`

## Why

The platform will rely on version-aware caches for retrieval, evidence, generation, provider health, and rate-limit coordination. Cache implementations must be bounded to avoid long-running memory growth.

## Performance Notes

- `maxEntries` is mandatory and must be at least 1.
- Cache values are copied on set/get so callers cannot mutate retained state.
- TTL expiry removes stale bytes.
- Stats collection purges expired entries before reporting memory usage.
- Eviction uses `Map` insertion order to remove the oldest key without sorting.

## TDD Notes

- RED: Added `packages/adapters/src/cache.test.ts`, then ran `pnpm --filter @knowledge/adapters test`.
- The test failed because `./cache` did not exist.
- GREEN: Added the cache contract and memory implementation.
- REFACTOR: Replaced sort-based eviction with insertion-order eviction and added extra coverage for bounded configuration and expiry cleanup.

## Verification

- `pnpm --filter @knowledge/adapters test`: passed.
- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: above 90% for lines, statements, branches, and functions.
- `pnpm --filter @knowledge/core test:coverage`: passed.

## Known Risks And Follow-Up

- This is a bounded memory cache contract implementation, not the final Cloudflare KV or Redis adapter.
- Future KV/Redis adapters must preserve TTL, bounded access, and byte-copy semantics where applicable.
