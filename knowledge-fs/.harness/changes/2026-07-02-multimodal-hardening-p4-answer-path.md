# Multimodal hardening P4 — main answer path

Date: 2026-07-02

The primary answer path (`createLlmAnswerQueryGenerator`, used whenever an LLM answer generator is
configured) had NO multimodal support: the VLM provider, candidate resolver, and multimodal evidence
were only wired into the alternate `createHybridQueryGenerator` branch, so configuring a VLM provider
alongside an LLM answer generator silently did nothing.

## S4.1 — VLM in the LLM answer generator

`createLlmAnswerQueryGenerator` now accepts `multimodalAnswerProvider` / `multimodalCandidateResolver`
/ `maxMultimodalEvidenceItems`. When the retrieval has multimodal evidence and a VLM provider is
configured, it generates the answer via the VLM (mirroring the hybrid generator).

## S4.2 — candidate resolver wired in apps/api

`DocumentMultimodalCandidateResolver` was defined/tested but never instantiated in production, so
citations were never enriched. `apps/api/src/index.ts` now builds it from the database
`documentAssets`/`parseArtifacts` repositories (available in the same mode as the retriever) and
passes it into BOTH query generators, so citations gain manifestItemId / asset route / page / bbox.

## S4.3 — VLM failure falls back to the text LLM

The hybrid generator awaited `multimodalAnswerProvider.generate` with no try/catch, so one bad image
or a transient VLM error aborted the whole answer. The LLM generator now wraps the VLM call: on
failure (throw or empty text) it degrades to the text LLM stream and records
`multimodalAnswerFailure` in the done-event metadata.

## S4.4 — OCR/caption/textPreview reach the answer

The resolver output and `MultimodalEvidenceAttachment` dropped the visual text, so text-only models
got only an asset route they cannot read. The resolver now carries `caption`/`ocrText`/`textPreview`
from the manifest item, the evidence attachment surfaces them, and both the text-fallback prompt and
the VLM evidence include them.

## S4.5 — total VLM payload budget

`createObjectStorageContentBlockMultimodalAnswerProvider` capped per-image bytes and attachment count
but not cumulative payload. Added `maxTotalImageBytes` (default 32 MB); the loader stops once the
cumulative image bytes would exceed it.

## Deferred

- **S4.6** — memoize the resolver's per-citation manifest build within one answer. A performance
  optimization (bounded by `limit`), not a correctness bug; a safe implementation needs a
  request-scoped or artifact-hash-keyed bounded cache. Left as a follow-up.

## Tests

`llm-answer-query-generator.test.ts`: VLM-preferred (text LLM not called), VLM-failure fallback (text
LLM called, `multimodalAnswerFailure` recorded, OCR/caption in the prompt). Existing non-multimodal
tests unchanged (citation shape is a superset). Reasoned-verified — run `pnpm check`.
