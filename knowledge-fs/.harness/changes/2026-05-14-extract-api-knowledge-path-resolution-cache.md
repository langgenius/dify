# Extract API Knowledge Path Resolution Cache

## Summary

- Continued R6 API decomposition by moving `KnowledgePathResolutionCache` contracts, cache key validation, permission snapshot normalization, max path byte guard, TTL writes, corrupt-entry handling, and clone-isolated path serialization into `packages/api/src/knowledge-path-resolution-cache.ts`.
- Preserved bounded cache-key behavior and stable hashed cache keys while keeping `index.ts` as the gateway composition surface.
- Added a code-health guardrail to keep the path resolution cache implementation out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/knowledge-path-resolution-cache.test.ts src/code-health.test.ts` failed because `knowledge-path-resolution-cache.ts` did not exist.
- GREEN: implemented the extracted module, re-exported it, and removed the cache implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-path-resolution-cache.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 10 after review checkpoint `6f3cfc8`; after this commit is pushed, feature work must pause for the mandatory 10-commit health review.
