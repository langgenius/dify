# Dense Embedding Retrieval And Ingest Wiring

## What Changed

Turns on the dense (semantic) half of hybrid retrieval end-to-end. Previously the
dense path was stubbed: the hybrid query used a `[0]` placeholder vector and
`searchDense` always returned `[]`, so "hybrid" retrieval was effectively
FTS + rerank only.

- `apps/api/src/embedding-options.ts` (new) — `createApiEmbeddingOptions()`
  resolves the embedding provider/model from env (`KNOWLEDGE_EMBEDDING_PROVIDER`
  = `openai` / `cohere` / `voyage` / `static` / `off`, with auto-detection from
  `*_API_KEY` when unset). Returns `{}` (dense disabled) for `off` or when no key
  is present; throws on an invalid provider name or a missing required key.
- `apps/api/src/embedding-options.test.ts` (new) — covers provider selection,
  defaults, disable path, and validation errors.
- `apps/api/src/index.ts` — constructs `embeddingOptions`, passes
  `embeddingModel` + `embeddings` to the hybrid query generator, swaps the
  `searchDense: async () => []` stub for `retrievalRepository.searchDense`, spreads
  `embeddingOptions` into the gateway, and reports `embedding` component health.
- `packages/api/src/index.ts` (`createKnowledgeGateway`) — accepts
  `embeddingProvider` + `denseEmbeddingModel`; when set, adds a
  `createDenseVectorProjectionBuilder` to the incremental reindexer and threads
  `synchronousUploadDenseModel` so synchronous-upload ingestion writes dense
  projections. Throws if `embeddingProvider` is set without `denseEmbeddingModel`.
- `packages/api/src/gateway-options.ts` — adds `embeddingProvider` +
  `denseEmbeddingModel` to `KnowledgeGatewayOptions`.
- `packages/api/src/hybrid-query-generator.ts` — embeds the query
  (`inputType: "search_query"`) into a real `queryVector`; requires
  `embeddingModel` when an embeddings provider is configured; falls back to an
  empty vector when the embedder returns no dense vector.
- `packages/api/src/hybrid-query-generator.test.ts` — adds the embed-query case.
- `packages/api/src/document-write-handlers.ts` /
  `packages/api/src/gateway-document-write.test.ts` — thread
  `synchronousUploadDenseModel` into the reindexer.

## Why It Changed

The retrieval pipeline already fused FTS and dense candidates, but no embedding
provider was wired in, so the dense side contributed nothing. This change makes
dense retrieval and dense projection writing functional and configuration-gated,
without altering behavior when embeddings are not configured.

Carved out of the `feat/aws-terraform-and-s3-instance-role` working tree into its
own branch/PR so the behavioral change is reviewed independently of the infra
restructure (PR #8). Branched from `main`.

## Verification

- `@knowledge/api` tests: 608/608 pass.
- `@knowledge/api-app` tests (incl. `embedding-options`): 41/41 pass.
- Typecheck: passes (`pnpm check` reported all typecheck tasks successful).
- Behavior is opt-in: with no embedding env (`embedding: false` in `/health`),
  `createApiEmbeddingOptions()` returns `{}` and the pipeline behaves exactly as
  before (FTS + rerank), so existing gateway/retrieval tests are unaffected.

## Performance And Reliability Notes / Follow-ups

- **Fixed 1536-dimension constraint (known limitation).** `index_projections.dense_vector`
  is `vector(1536)` with an hnsw index, and nothing reconciles the provider's
  output dimension with it. Only 1536-dimension models work as-is
  (`openai text-embedding-3-small`, `cohere embed-v4`); `static` (default 384) and
  `voyage-3` (1024) would fail at DB insert/search against real Postgres. Unit
  tests use the in-memory projection repository, so this is not caught by
  `pnpm check`. Operators must configure a 1536-dim model. Best-practice fix
  (configurable/variable dimensions) tracked in issue #10.
- **Coverage gate.** `pnpm check` fails the `@knowledge/api` branch-coverage
  threshold (~89.26% vs 90%). This is **pre-existing on `main`** (measured on a
  clean `origin/main` checkout) and spread across many unrelated files; this PR is
  at parity and does not regress it. Raising coverage to ≥90% is a separate effort.
