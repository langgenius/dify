# EvidenceBundle Cache

## Summary

- Added a bounded EvidenceBundle cache boundary backed by `CacheAdapter`.
- Cache keys include query, permission, strategy, metadata filters, and index projection inputs.

## Changes

- Added `createEvidenceBundleCache()`.
- Added `EvidenceBundleCacheKeyInput` and `EvidenceBundleCache` contracts.
- Cache key inputs include:
  - `knowledgeSpaceId`
  - query digest
  - sorted permission snapshot
  - retrieval strategy
  - strategy version
  - index projection fingerprint
  - metadata filters
- Cache keys use SHA-256 and do not include raw query text.
- Cached payloads are validated with `EvidenceBundleSchema`.
- Cache hits return clone-isolated `EvidenceBundle` objects.
- Corrupt cache payloads return cache miss instead of a half-valid bundle.

## Performance Notes

- Uses the existing bounded `CacheAdapter`; no database or provider calls were introduced.
- Query text is hashed before key construction to avoid long or sensitive cache keys.
- Permission snapshots are sorted so equivalent snapshots share the same cache entry.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
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

- This slice will be implementation commit 4 after review checkpoint `f950b59`.
- The next 10-commit review is not due yet.
