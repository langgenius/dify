# KnowledgePath Cache Key Hardening

## Summary

- Expanded `KnowledgePathResolutionCacheInput` so cache keys include tenant id, KnowledgeSpace id,
  permission snapshot, manifest version, mount version, path index version, command name, virtual
  path, and optional target version.
- Added cache tests proving normalized permission snapshot order still hits while tenant,
  manifest, mount, command, and target-version changes miss.
- Preserved hashed key output and path byte bounds so virtual paths are not leaked into cache keys.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-path-resolution-cache.test.ts src/cache-polish.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
