# Native Gemini Embedding Provider

## What Changed

- Added `createGeminiEmbeddingProvider` to `@knowledge/embeddings`, calling Google's native `POST /v1beta/models/{model}:batchEmbedContents` endpoint.
- Authenticates with the `x-goog-api-key` header (not `Authorization: Bearer`); generalized the shared HTTP embedding machinery to support per-provider auth (`apiKeyAuth: "bearer" | "google"`) and a per-model request path (`requestPath: (model) => string`).
- Request bodies map each text to `{ content: { parts: [{ text }] }, model: "models/{model}", outputDimensionality }`. `gemini-embedding-2` does **not** accept the `task_type` field, so the task is encoded as a text instruction prefix derived from `EmbeddingInputType`: `search_query` → `task: search result | query: {text}`, `search_document` → `title: none | text: {text}`, `classification` → `task: classification | query: {text}`, `clustering` → `task: clustering | query: {text}` (default `search_document`).
- Each request sends `outputDimensionality` equal to the registered model dimension (Matryoshka truncation), and the parser **L2-normalizes** every returned vector. `gemini-embedding-2` auto-normalizes sub-3072 dimensions, but the `index_projections.dense_vector` column is a fixed `vector(1536)` with a `vector_l2_ops` HNSW index — L2 distance only matches cosine ranking on unit-length vectors — so the provider re-normalizes to keep index correctness self-contained and independent of any provider promise.
- Responses are parsed from the ordered `{ embeddings: [{ values: [...] }] }` shape and validated against the model dimension; normalized vectors are passed to `buildResult`, which clones at the ownership boundary. `batchEmbedContents` with one content per request returns one embedding per text (aggregation only happens within a single multi-part request).
- Registered the default model `gemini-embedding-2` (GA, multimodal; 3072-dim native, 8192 input tokens) at **1536 dims** (cosine) to match the fixed `vector(1536)` column, so it works out of the box with the existing schema and HNSW index.
- Fixed the `static` provider default dimension (`DEFAULT_STATIC_EMBEDDING_DIMENSION`) from 384 to 1536 so the no-API-key dev provider also fits the fixed `vector(1536)` column.
- Wired `gemini` into `apps/api` `createApiEmbeddingOptions`: selectable via `KNOWLEDGE_EMBEDDING_PROVIDER=gemini` or auto-detected from `GEMINI_API_KEY`, with optional `GEMINI_BASE_URL` override; updated `normalizedProvider` and `requiredKey` accordingly.
- Added `GEMINI_API_KEY` / `GEMINI_BASE_URL` passthrough to `infra/local/compose.yaml` and the env example files so Gemini is reachable in the Docker stack.

## Why

- User request: make the embedding provider support Google Gemini as a first-class provider via the native Gemini Developer API (`generativelanguage.googleapis.com`), with `gemini-embedding-2` as the default model.
- `gemini-embedding-2` is the current GA multimodal Gemini embedding model and is available on the Developer API `batchEmbedContents` endpoint; its task-instruction-prefix scheme replaces the `task_type` enum used by `gemini-embedding-001`.

## Verification

- `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
- `pnpm --filter @knowledge/embeddings test:coverage`
- `pnpm --filter @knowledge/api-app test -- src/embedding-options.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm compose:config` && `pnpm compose:apps:test`
- `git diff --check`

## Known Risks / Follow-Up

- Embedding dimension is fixed at 1536 to match the `vector(1536)` column. Other Gemini output dimensionalities (e.g. 768, 3072) would require altering the `index_projections.dense_vector` column and its HNSW index, which is a schema-migration concern out of scope here.
- Pre-existing dimension mismatches remain for non-default models registered at other sizes (`voyage-3` at 1024, `text-embedding-3-large` at 3072); they would not fit the fixed `vector(1536)` column and are out of scope for this change.
- The reranker layer is untouched; Gemini is an embedding provider only.
