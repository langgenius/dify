# Plugin-daemon Model Routing — Phase 5 (KnowledgeFS enrichment tenant + visual-embedding exception)

Date: 2026-07-01

## Context

Final phase of the plugin-daemon model-routing work. Closes the Phase 1 tenant-threading gap on the
KnowledgeFS read path and documents the one seam that cannot route to plugin-daemon.

## What Changed

### KnowledgeFS enrichment tenant threading (closes the Phase 1 gap)
Previously the three `multimodalManifestEnhancer.enhance(...)` calls inside
`packages/api/src/knowledge-fs-command-registry.ts` (reached via `cat` / `grep` / `diff` of
`multimodal.json`) had no tenant in scope, so they passed `tenantId: undefined` — which the
plugin-daemon enrichment adapter rejects at runtime. `tenantId` is now threaded end to end:

- `readDocumentText` gains a `tenantId?` param and forwards it to all three `enhance(...)` calls.
- The intermediate helpers `catKnowledgeFsPath`, `grepKnowledgePathResource`, `grepKnowledgeFsPath`,
  and `diffKnowledgeFsPaths` gain a `tenantId?` param and forward it down.
- The `cat`, `grep`, and `diff` command handlers pass `context.subject.tenantId`; the `write` path
  (`writeKnowledgeFsDocument`, which already had `subject`) passes `subject.tenantId`.

Additive/behavior-neutral (optional field; non-plugin-daemon enhancers ignore it).

### Image-byte visual embedding exception (documented)
Dify's standard model runtime has **no image-embedding model type**, so the image-byte
`ImageBytesVisualEmbeddingProvider` seam has **no plugin-daemon equivalent**. It stays on its
existing HTTP adapter (`apps/api/src/visual-embedding-options.ts`). The visual **text-query**
embedding can route through the plugin-daemon `text_embedding` op (via the standard embedding
adapter) as a follow-up; the image-byte path is the documented exception. Cross-referenced in
`.harness/docs/multimodal-knowledgefs-iteration-plan.md` (shared-column constraint note).

## How It Was Verified

- Type-driven threading; reasoned-verified only (no Node runtime here). Run `pnpm check`.

## Status: plugin-daemon model routing complete

All planned phases are implemented on branch `feature/plugin-daemon-model-routing`:
- Phase 0: `@knowledge/plugin-daemon-client` transport.
- Phase 1: per-request `tenantId` threaded to every model-call seam (now including KnowledgeFS).
- Phase 2: text embedding adapter + wiring.
- Phase 3: rerank + LLM adapters + wiring (answer + semantic extraction).
- Phase 4: multimodal answer + enrichment adapters (VLM via the `llm` op).
- Phase 5: KnowledgeFS tenant gap closed; image-byte visual embedding documented as an exception.

Outstanding follow-ups (documented in the per-phase summaries):
- Verify the multimodal `prompt_messages` content-part serialization against the deployed dify
  version (Phase 4 assumption).
- Optional: route visual text-query embedding through the daemon.
- `pnpm install` (new workspace deps) + full `pnpm check`; add integration smokes against a stub
  daemon.
