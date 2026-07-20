# Cache Polish: Model, Permission, And Index Versions

## Summary

- Added version-aware embedding and rerank provider cache wrappers.
- Added a KnowledgeFS path resolution cache boundary with permission snapshot and path index version in the key.
- Kept cache keys digest-based so raw query text, document text, and virtual paths are not exposed in cache keys.

## Changes

- Added `createCachedEmbeddingProvider()` in `@knowledge/embeddings`.
- Added `createCachedRerankerProvider()` in `@knowledge/embeddings`.
- Added `createKnowledgePathResolutionCache()` in `@knowledge/api`.
- Added focused cache tests covering model/tokenizer version changes, malformed cache entry recovery, clone isolation, permission snapshot ordering, path index version isolation, and bounded path input.

## Guardrails

- Embedding cache keys include provider kind, model id, model version, tokenizer version, input type, and text digests.
- Rerank cache keys include provider kind, model id, model version, query digest, topN, document ids, document metadata digest, and document text digests.
- Path resolution cache keys include knowledge space id, permission snapshot, path index version, and virtual path digest.
- Cache entry size, TTL, cache version, and path byte bounds are validated.
- Malformed or stale cache entries are ignored and refreshed instead of throwing runtime errors.

## Verification

- RED first:
  - `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts` failed because cached provider factories did not exist.
  - `pnpm --filter @knowledge/api test -- src/cache-polish.test.ts` failed because `createKnowledgePathResolutionCache()` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
  - `pnpm --filter @knowledge/api test -- src/cache-polish.test.ts`
  - `pnpm --filter @knowledge/embeddings test:coverage`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/embeddings typecheck`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm lint`

## Commit Tracking

- This slice is review checkpoint `92f4e22` + implementation commit 5 after commit and push.
- The next 10-commit health review is not yet due.
