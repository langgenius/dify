# Permission Filtering

## Summary

- Added permission-aware filtering to hybrid retrieval.
- Unauthorized candidates are removed before RRF fusion and reranking.

## Changes

- Extended retrieval candidates with node `permissionScope`.
- Extended hybrid retrieval input with optional caller `permissionScope`.
- Selected `knowledge_nodes.permission_scope` in dense-vector and FTS retrieval SQL through the existing joined query.
- Filtered protected candidates before WASM/native RRF fusion.
- Preserved public candidates whose node permission scope is empty.
- Added `permissionFilteredCandidates` to retrieval metrics when filtering removes candidates.

## Performance Notes

- Filtering runs over already bounded dense and FTS candidate arrays.
- No extra database query, object storage read, cache read, or provider call was introduced.
- Retrieval SQL still uses the same bounded joins and explicit `maxRows` limits.

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

## Review Cadence

- This slice will be implementation commit 2 after review checkpoint `f950b59`.
- The next 10-commit review is not due yet.
