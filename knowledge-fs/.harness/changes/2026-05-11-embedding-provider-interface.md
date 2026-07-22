# Embedding Provider Interface

## Summary

- Added `@knowledge/embeddings` as the provider boundary for external embedding APIs.
- This completes Sprint 3 task `1.3.5` without wiring embeddings into index projection persistence yet.

## Behavior

- Added `EmbeddingProvider`, `EmbeddingModelInfo`, dense embedding result, and optional sparse vector contracts.
- Added OpenAI-compatible, Voyage-compatible, and Cohere-compatible provider factories using injected `fetch`.
- Added deterministic `createStaticEmbeddingProvider()` for local tests and future offline skeleton paths.
- Provider calls validate model support, batch size, per-text byte limits, response size, response schema, vector count, vector dimension, and sparse-vector shape.

## Performance And Safety

- Embedding requests are batched through one provider call instead of per-node request loops.
- Inputs require explicit non-empty bounded batches and bounded text bytes.
- Provider responses are read with a cumulative byte limit before JSON parsing.
- Dense/sparse vectors and model descriptors are cloned on return to avoid retaining mutable caller state.
- API keys are only placed in request headers and are not included in return metadata.

## Verification

- RED confirmed with embedding tests failing because `packages/embeddings/src/index.ts` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
  - `pnpm --filter @knowledge/embeddings test:coverage`
  - `pnpm --filter @knowledge/embeddings typecheck`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- Dense vector projection persistence remains the next Sprint 3 slice.
- Runtime environment wiring for real provider credentials should stay separate from the provider contract.
