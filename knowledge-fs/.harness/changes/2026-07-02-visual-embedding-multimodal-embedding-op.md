# Migrate image-byte visual embedding to the plugin-daemon multimodal_embedding op

Date: 2026-07-02

## Context

The image-byte visual embedding was the last model call outside the plugin-daemon (the documented
Phase-5 "http" exception, kept because older dify had no image-embedding model type). Current dify
DOES expose `multimodal_embedding/invoke` (found during the contract audit), so the exception is
retired and the seam now routes through the daemon like everything else.

## Dify contract (authority: local dify checkout)

- `api/core/plugin/impl/model.py invoke_multimodal_embedding`:
  `POST plugin/{tenant_id}/dispatch/multimodal_embedding/invoke`, data
  `{provider, model_type:"text-embedding", model, credentials, documents, input_type}`.
- Document shape (`api/core/rag/datasource/vdb/vector_factory.py`):
  `{content: <base64 of file bytes>, content_type: DocType ("image"), file_id}`; ingestion uses
  `input_type: "document"`, image queries `"query"` (lowercase `EmbeddingInputType`).
- Response is the same `EmbeddingResult {model, embeddings, usage:{tokens,total_tokens}}` as
  text_embedding.
- Text queries against a multimodal dataset use plain `embed_query` — i.e. the daemon
  `text_embedding` op on the SAME multimodal model (`retrieval_service.py` only special-cases
  IMAGE_QUERY via `search_by_file`).

## What Changed

- `packages/plugin-daemon-client`: `PluginDaemonOp` now includes `"multimodal_embedding"`.
- `apps/api/src/visual-embedding-options.ts` (rewritten):
  - Provider values: `plugin-daemon` | `off` (was `http` | `off`); still opt-in (unset → disabled).
  - Image-byte ingestion → daemon `multimodal_embedding` with dify's document shape
    (`file_id` = the image's objectKey, a stable per-asset identifier), `input_type:"document"`,
    per-request `tenantId` required (throws without it — tenant threading landed in Phase 1).
  - Text query into the visual space → reuses `createPluginDaemonEmbeddingProvider`
    (`text_embedding` op, same plugin/provider/model), mirroring dify retrieval exactly.
  - Env: removed `KNOWLEDGE_VISUAL_EMBEDDING_{ENDPOINT,TEXT_ENDPOINT,API_KEY}`; added
    `KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID` / `_PLUGIN_PROVIDER` / `_PLUGIN_CREDENTIALS_JSON`
    (same convention as every other capability); `_MODEL` is now required when enabled
    (no more `clip-image` default); env extends `PluginDaemonClientEnv`. `DIMENSION`,
    `MAX_ASSET_BYTES`, `PREFERRED_VARIANT`, `QUERY_MODE`, `QUERY_MODEL` unchanged.
  - Removed the HTTP image/text providers and the `fetch` option.
- `packages/embeddings`: `EmbeddingProviderKind` narrowed to `"plugin-daemon" | "static"` — the
  `"http"` member existed solely for the retired visual exception.
- Tests rewritten (`visual-embedding-options.test.ts`): daemon SSE stub verifies the
  multimodal_embedding URL + document payload, the text-query path via text_embedding
  (`input_type:"query"`), response mapping (wrapper provider tag becomes
  `plugin-daemon:plugin-daemon:image-bytes`), missing-tenant error, and env validation.

## Notes

- dify normalizes multimodal vectors client-side (`vector / np.linalg.norm`) before storage; we
  store raw daemon vectors. Ranking under the cosine metric is scale-invariant and both the stored
  image vectors and query vectors come from the same daemon path, so this is consistent — but keep
  it in mind if a dot-product index is ever introduced.
- Deployment note: this retires the standalone CLIP HTTP service; deployments must configure the
  visual plugin (`KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID/_PLUGIN_PROVIDER/_MODEL`) instead, and the
  daemon-side plugin must support the multimodal_embedding capability.

## Verification

- Reasoned + grep verified: no references to the removed env fields or the `"http"` kind remain;
  tenantId threading to `embedAssets`/`embedImages` confirmed end-to-end (reindexer → projection
  builder → wrapper → adapter). No Node runtime here — run `pnpm check`.
