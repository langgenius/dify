# Reranker Provider Interface

## What Changed

- Added `RerankerProvider`, rerank input/output types, and reranker model metadata to `@knowledge/embeddings`.
- Added Cohere-compatible and Voyage-compatible HTTP reranker providers.
- Added deterministic static reranker for local tests and fallback behavior.
- Added tests for request mapping, response mapping, clone isolation, input bounds, provider failures, malformed payloads, oversized responses, and duplicate result indexes.

## Why

Sprint 5 needs a provider-agnostic reranking boundary before retrieval runtime can rerank expanded hybrid recall candidates. The existing embeddings package already owns external model provider contracts, so reranking now follows the same shape and verification style.

## Performance And Safety Notes

- Rerank requests are bounded by document count and per-document byte size before `fetch` is called.
- Provider responses are read with an explicit byte ceiling.
- Result indexes are validated against the original bounded document list, and duplicates are rejected.
- Returned documents and metadata are clone-isolated so callers cannot mutate provider-retained state.
- The implementation does not add database calls or runtime-global caches.

## Verification

- `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
- `pnpm --filter @knowledge/embeddings test:coverage`
- `pnpm --filter @knowledge/embeddings typecheck`
- `pnpm lint`
- `pnpm check`
- `pnpm build`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- Retrieval runtime does not yet call the reranker provider; that is the next Sprint 5 integration slice.
- Provider-specific request/response variants may need expansion as concrete production models are selected.
