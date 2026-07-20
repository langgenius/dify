# Multimodal hardening P2 — enrichment cost/abuse controls

Date: 2026-07-02

`document-multimodal-manifest-enhancer.ts` (+ apps/api wiring).

## S2.1 — Bounded provider fan-out

The enhancer fired `provider.enrich` for every item (up to `maxItems`, default 100) via a single
`Promise.all`, so one manifest read could launch ~100 concurrent VLM/plugin-daemon calls. Replaced
with an order-preserving bounded-concurrency runner; `maxConcurrency` option (default 4), wired from
`KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY`.

## S2.2 — Single-flight the cached enhancer

`createCachedDocumentMultimodalManifestEnhancer` now keeps an in-flight promise map keyed by
`(documentAssetId, version)`, so N concurrent first-reads of the same uncached manifest share one
enhancement instead of each running the full fan-out (cache-miss stampede).

## S2.3 — Honest `enhancedItems`

`enhancedItems` was hardcoded to `attemptedItems` (page/code/no-op items counted as enhanced). Now an
item counts as enhanced only when the provider actually changed it (`attemptedItems` still reported
separately).

## S5.4 (landed early, same file) — cache freshness includes model/promptVersion

The enhancer now exposes its `model`/`promptVersion`; the cached wrapper folds the cached manifest's
`metadata.enrichment.model`/`promptVersion` into the freshness check, so a model or prompt redeploy
invalidates stale captions/OCR instead of serving them forever.

## Tests

`document-multimodal-manifest-enhancer.test.ts`: honest-count (empty-result → 0), bounded-concurrency
(peak ≤ maxConcurrency), single-flight (one provider call for two concurrent reads), model/promptVersion
staleness (re-enrich after model change). Existing tests unchanged (their providers return real
changes and share the same model/prompt).

Reasoned-verified only — run `pnpm --filter @knowledge/api test` + `pnpm check`.
