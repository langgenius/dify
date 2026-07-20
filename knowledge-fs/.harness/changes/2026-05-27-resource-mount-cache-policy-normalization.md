# ResourceMount Cache Policy Normalization

## Summary

- Added `ResourceMountCachePolicySchema` with a default `{ strategy: "none" }` policy.
- Bounded mount cache policy knobs to `ttlSeconds <= 86400` and `maxBytes <= 1073741824`.
- Added `resourceMountPathCachePolicy` to normalize mount cache settings into path metadata cache
  options with millisecond TTLs and explicit disabled state.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/api test -- src/resource-mount-repository.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
