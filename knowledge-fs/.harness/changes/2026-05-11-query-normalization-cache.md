# Query Normalization Cache

## Summary

- Added a bounded query normalization cache for Phase 2 Sprint 5 retrieval hardening.
- The cache reuses the shared `CacheAdapter` contract and stores normalized query metadata behind strategy-versioned SHA-256 keys.
- Raw query text is intentionally excluded from cache keys.

## Changes

- Added `createQueryNormalizationCache()` to `@knowledge/api`.
- Normalization output includes:
  - `normalizedQuery`
  - `queryLanguage`
  - `strategyVersion`
  - `cacheHit`
- Cache entries are written with explicit TTL.
- Cache reads validate payload shape and reject corrupted entries.
- Inputs and config are bounded:
  - empty query rejected
  - oversized query rejected by `maxQueryBytes`
  - invalid `ttlMs`, `maxQueryBytes`, and blank `strategyVersion` rejected

## Performance Notes

- Cache keys are deterministic and low-cardinality by strategy version plus digest.
- The implementation avoids retaining raw query text in keys.
- Query inputs are byte-limited before normalization.
- Cache values are small JSON payloads and inherit adapter-level TTL/size bounds.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice will be implementation commit 7 after review checkpoint `b7ac774`.
- The 10-commit review checkpoint is not due yet.
