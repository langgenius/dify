# Reranking Retrieval Integration

## What Changed

- Integrated optional `RerankerProvider` support into `createBasicHybridRetriever()`.
- Added `rerankerModel` and `maxRerankCandidates` configuration with validation.
- Changed planned retrieval to preserve a bounded fusion window for reranking before final output limiting.
- Added rerank score/original retrieval score metadata and rerank latency/candidate metrics.
- Added tests proving reranking reorders planned hybrid candidates and does not issue unbounded rerank requests.

## Why

Sprint 5 requires the production retrieval flow to expand recall, fuse candidates, then rerank a bounded candidate window before returning final evidence.

## Performance And Safety Notes

- Dense and FTS searches still run in parallel.
- Reranking only runs when a reranker is configured and the retrieval plan asks for a rerank candidate window.
- `maxRerankCandidates` caps provider payload size independently of planner fanout.
- Reranker documents contain only bounded candidate text and low-cardinality metadata, not vectors or credentials.
- No additional database round trips are introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- `pnpm check`
- `pnpm build`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- Runtime app composition still needs to wire a real reranker provider from environment configuration.
- Reranker input text currently prefers FTS text and falls back to section path when full node text is not present in retrieval metadata.
- Dense-only candidates may need richer text hydration once retrieval repositories expose node text directly.
