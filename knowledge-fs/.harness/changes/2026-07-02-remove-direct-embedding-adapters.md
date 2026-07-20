# Remove direct-provider adapters from @knowledge/embeddings (slice 1 of 2)

Date: 2026-07-02

## Context

Follow-up to the plugin-daemon-only provider selection: the apps/api wiring already routes all
embedding/reranking through the plugin-daemon, leaving the vendor SDK adapters in
`@knowledge/embeddings` as unused library code. Per the maintainer, delete them. Done as slices —
this is embeddings; `@knowledge/generation` (the chat providers) is the next slice.

## What Changed (`packages/embeddings/src/index.ts`)

Deleted the entire direct-HTTP provider chain:
- Factories: `createOpenAIEmbeddingProvider`, `createVoyageEmbeddingProvider`,
  `createCohereEmbeddingProvider`, `createGeminiEmbeddingProvider`, `createCohereRerankerProvider`,
  `createVoyageRerankerProvider`.
- Internal engines + config: `createHttpEmbeddingProvider`, `createHttpRerankerProvider`,
  `ProviderConfig`, `RerankerProviderConfig`, `HttpEmbeddingProviderOptions`,
  `HttpRerankerProviderOptions`.
- Vendor model lists (openAI/voyage/cohere/gemini + cohere/voyage reranker) and the response zod
  schemas (OpenAI/Cohere/Gemini embedding + Cohere/Voyage rerank + shared dense/sparse/indexed).
- HTTP-only helpers: `requestBody`, `rerankRequestBody`, `parseEmbeddingResponse`,
  `parseRerankResponse`, `buildResult`, `buildRerankResult`, `l2Normalize`, `voyageInputType`,
  `geminiInstructionText`/`GEMINI_TASK_INSTRUCTIONS`, `denseVectorsByIndex`, `validateDenseVectors`,
  `validateSparseVectors`, `fetchWithRetries`, `boundedResponseText`,
  `boundedRerankerResponseText`, `validateRetryOptions`, `isRetryableProviderStatus`,
  `providerRequestError`, `sleepMs`, and the HTTP-only defaults (`defaultMaxResponseBytes`,
  `defaultMaxRetries`, `defaultRetryDelayMs`).
- Dead error classes `ProviderRequestError` / `ProviderRateLimitError` (only the deleted HTTP path
  threw them; the `@knowledge/parsers` and `@knowledge/generation` copies are separate and untouched)
  and their `ProviderErrorCode` members.

Kept: `createStaticEmbeddingProvider`, `createStaticRerankerProvider`, the cached wrappers, the
plugin-daemon embedding/reranker adapters, input validators, `findModel`/`findRerankerModel`, the
static-scoring + cache helpers, and `ProviderError`/`ProviderInputError`/`ProviderResponseError`.

Kind unions narrowed to what remains:
- `EmbeddingProviderKind = "http" | "plugin-daemon" | "static"` — `"http"` is **deliberately kept**
  for the bespoke image-byte visual-embedding path (`apps/api/src/visual-embedding-options.ts`), the
  documented Phase-5 exception (Dify has no image-embedding model type).
- `RerankerProviderKind = "plugin-daemon" | "static"`.

## Tests

`embedding.test.ts` rewritten to cover only the surviving providers: the existing cached
embedding/reranker + cache-bound tests (verbatim) plus new focused static embedding/reranker tests
(determinism, `models()`, unsupported-model + input-validation errors). Removed all HTTP
provider tests and the `createJsonFetch`/`RecordedRequest` stubs. The plugin-daemon adapter tests
(`plugin-daemon-embedding.test.ts`, `plugin-daemon-rerank.test.ts`) are unchanged.

## Verification

- Grepped the package and the whole repo: no dangling references to any deleted symbol; no external
  importer of the deleted factories; `stableJson`/`z`/`createHash`/`PluginDaemonClient` imports still
  used; `EmbeddingProviderKind = "http"` only referenced by visual-embedding-options.
- No Node runtime here — **must run** `pnpm --filter @knowledge/embeddings test` and `pnpm check`
  (coverage ≥90%: removed code and its tests were dropped together, but confirm the gate).
