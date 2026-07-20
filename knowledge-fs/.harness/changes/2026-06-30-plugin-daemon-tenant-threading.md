# Plugin-daemon Model Routing — Phase 1 Tenant Threading

Date: 2026-06-30

## Context

Continues the plugin-daemon model-routing work. Phase 1 threads the real per-request `tenantId`
down to every model-invocation provider input, so the plugin-daemon adapters (which require a tenant
in the dispatch URL) receive it. Additive and behavior-neutral: direct providers ignore the field.

## What Changed

`tenantId` is now carried from the request/job entry to each model-call provider input. The optional
`tenantId?` field was added to the relevant input types and the value is threaded through:

- **Ingestion (embedding/visual)**: `BuildDenseVectorProjectionInput` /
  `BuildVisualEmbeddingProjectionInput` / `EmbedVisualAssetsInput` / `EmbedVisualImagesInput`
  (`index-projection-builders.ts`); the dense/visual builders forward it to `embeddings.embed` /
  `provider.embedAssets` / `provider.embedImages`. The reindexer (`index-reindexer.ts`) passes
  `input.tenantId` to the builders, and the sync upload handler (`document-write-handlers.ts`) now
  passes `subject.tenantId` to `reindex` (the async worker already did).
- **Ingestion (semantic LLM)**: entity/relation/community extraction —
  `ExtractKnowledgeNode{Entities,Relations}Input`, `{Entity,Relation}ExtractionProviderInput`,
  `Generate{Entity,Relation,CommunitySummary}TextInput`, `SemanticCommunitySummaryInput` — threaded
  from `semantic-ingestion-postprocessor.ts` through the flows and providers down to
  `LlmProvider.generate` (the providers receive the raw `LlmProvider`, which now accepts `tenantId`
  via `GenerateTextInput`).
- **Query/retrieval**: generators read `input.subject.tenantId` and pass it to the query embedding
  (`embedQueryVector` / `embeddings.embed`), `retriever.retrieve`, the answer `provider.stream`
  (`GenerateAnswerStreamInput`), and the multimodal answer provider boundary
  (`MultimodalAnswerProviderInput`). `SearchDenseInput`/`SearchFtsInput` carry it, and
  `hybrid-retrieval.ts` forwards it to `searchDense`/`searchFts` and `rerankHybridRetrievalItems`
  (→ `reranker.rerank`). Retrieval-path wrappers preserve it via `...input`.
- **Read (enrichment VLM)**: `EnhanceDocumentMultimodalManifestInput`,
  `DocumentMultimodalEnrichmentProviderInput`, `DocumentMultimodalUnderstandingProviderInput`
  threaded from `document-read-handlers.ts` (`subject.tenantId`) through the enhancer to
  `provider.understand`. The cached enhancer forwards it via `...input`.

## Why

So the plugin-daemon adapters can route each model call under the correct tenant without a global
interface rewrite. The fields are optional, so existing direct providers are unaffected.

## How It Was Verified

- Type-driven threading; reasoned-verified only (no Node runtime here). Correctness of the threading
  is largely enforced by `tsc` — run `pnpm check` locally. Per-seam behavioral tests (mock provider
  captures `tenantId`) are a recommended follow-up.

## Known Gaps / Follow-up

- The three KnowledgeFS command-registry enrichment `enhance(...)` calls
  (`knowledge-fs-command-registry.ts`, inside `readDocumentText`-style helpers) do not yet have a
  tenant in scope, so they pass `tenantId: undefined` on that specific read path. Plumbing the
  session tenant through those helpers is a small follow-up; it only matters once the plugin-daemon
  enrichment adapter is wired (Phase 4) and reached via KnowledgeFS `cat`.
- Multimodal answer/enrichment internal forwarding to the LLM completes with the Phase 4 adapters.
