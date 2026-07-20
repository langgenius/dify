# Plugin-daemon Model Routing — Foundation (Phase 0–2 reference)

Date: 2026-06-30

## Context

knowledge-fs is becoming a subproject of Dify and should invoke models the way Dify does — through
the **plugin-daemon** service (`POST {url}/plugin/{tenant_id}/dispatch/{op}/invoke`, SSE) — carrying
the real per-request tenant, with credentials resolved daemon-side. This is the first increment of a
phased rollout (plan: route all 6 model-call seams). See
`/Users/jyong/.claude/plans/humming-brewing-ladybug.md`.

## What Changed (this increment)

- **New package `@knowledge/plugin-daemon-client`** (`packages/plugin-daemon-client/`): a pure leaf
  transport implementing the plugin-daemon contract.
  - `createPluginDaemonClient({baseUrl, apiKey, fetch?, maxResponseBytes?, maxRetries?, retryDelayMs?, sleep?})`
    with `dispatchUnary` (embedding/rerank — final envelope) and `dispatchStream` (llm — every chunk).
  - SSE multi-line `data:` parsing, `{code,message,data}` envelope unwrap with nested
    PluginInvokeError handling (`PluginDaemonError`), bounded response reads, and retry on
    408/409/425/429/5xx. Ported from the house patterns in `packages/generation/src/index.ts`.
  - Full unit tests (`src/index.test.ts`).
- **tenantId input fields (Phase 1 start)**: added optional `tenantId?` to `EmbedTextsInput`,
  `RerankDocumentsInput` (`packages/embeddings/src/index.ts`) and `GenerateTextInput`
  (`packages/generation/src/index.ts`). Additive and behavior-neutral; the plugin-daemon adapters
  require it, direct providers ignore it.
- **Reference adapter (Phase 2)**: `createPluginDaemonEmbeddingProvider` in
  `packages/embeddings/src/index.ts` implements `EmbeddingProvider` over the daemon `text_embedding`
  op (kind `"plugin-daemon"` added to `EmbeddingProviderKind`). Maps `inputType`
  search_query→QUERY / else→DOCUMENT, sends empty `credentials` (daemon-resolved), validates the
  response vector count. Tests in `src/plugin-daemon-embedding.test.ts`.

## Why

- Establishes the shared transport + the per-capability adapter pattern (selectable provider kind)
  with the text-embedding seam as the verified reference, before threading tenant everywhere and
  adding the rerank/LLM/multimodal adapters.

## How It Was Verified

- TDD throughout; reasoned-verified only — this environment has no Node runtime, so tests were not
  executed here.
- IMPORTANT: a one-time `pnpm install` is required to register the new workspace package and link
  `@knowledge/plugin-daemon-client` (the lockfile is NOT updated in this commit). Then run
  `pnpm --filter @knowledge/plugin-daemon-client test`, `pnpm --filter @knowledge/embeddings test`,
  and `pnpm check`.

## Remaining Work (next increments)

- Phase 1 (rest): thread the `tenantId` value through the query/retrieval, ingestion, and read
  (enrichment) call chains down to each provider input.
- Phase 3: rerank + LLM (`createPluginDaemonRerankerProvider`, `createPluginDaemonLlmProvider`).
- Phase 4: multimodal answer + enrichment (VLM via the llm op with image content blocks).
- Wiring: `KNOWLEDGE_*_PROVIDER=plugin-daemon` in `apps/api/src/*-options.ts` + `apps/api/src/index.ts`.
- Phase 5: image-byte visual embedding documented as a plugin-daemon exception (no Dify model type).
