# Multimodal Hardening Iteration Plan

Date: 2026-07-02

Derived from the strict multimodal audit (three-way review of ingestion, retrieval+answer, and
read-path+safety). Goal: close the gaps where the flagship multimodal capabilities (visual-vector
retrieval, VLM answering) are silently non-functional or unsafe in the current main configuration,
and reconcile the plan's "Done" claims with reality.

Each slice lands with tests and its own commit+push. No JS runtime in this environment — every slice
is reasoned-verified; the user runs `pnpm check`. Severity tags from the audit.

## Phase 1 — Read-path safety (self-contained, highest value)

- **S1.1 [HIGH] Harden the asset binary response.** `document-read-handlers.ts` asset route:
  always add `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none';
  sandbox`; serve only an allowlist of inline-safe image types (png/jpeg/gif/webp) with their
  content-type, everything else (esp. `image/svg+xml`, `text/html`, octet-stream) with
  `Content-Disposition: attachment` and a neutral `application/octet-stream` type.
  - Accept: an SVG asset is served as an attachment with nosniff+CSP and never inline.
- **S1.2 [HIGH] Cap asset read size.** Reject via 413 when `headObject().sizeBytes` exceeds a
  configurable `KNOWLEDGE_MULTIMODAL_ASSET_MAX_READ_BYTES` (default 25 MB) before `getObject`.
  - Accept: an oversized object returns 413 and is never buffered.
- **S1.3 [MED] Own-property variant lookup.** Resolve `variants[query.variant]` via `Object.hasOwn`
  so `__proto__`/`constructor` cannot select a prototype object.

## Phase 2 — Enrichment cost/abuse controls

- **S2.1 [MED] Bounded provider fan-out.** Replace the unbounded `Promise.all` over items in
  `document-multimodal-manifest-enhancer.ts` with a bounded-concurrency runner
  (`KNOWLEDGE_MULTIMODAL_ENRICHMENT_MAX_CONCURRENCY`, default 4).
  - Accept: with 100 items and concurrency 4, at most 4 provider calls run at once (test with a
    concurrency-tracking fake provider).
- **S2.2 [MED] Single-flight the cached enhancer.** Add an in-flight promise map keyed by
  `(documentAssetId, version)` so concurrent first-reads share one enhancement.
  - Accept: two concurrent misses invoke the underlying enhancer once.
- **S2.3 [MED] Real `enhancedItems` count.** Count an item as enhanced only when the provider
  returned a change; keep `attemptedItems` separate.

## Phase 3 — Visual retrieval leg (make it actually work)

> Status: S3.4 (RRF dedup) + S3.5 metric dedup landed (pure TS). S3.1/S3.2/S3.3/S3.5-queryMode
> deferred — they require the migration renderer (`renderMigrationSql`) + a live Postgres/TiDB to
> verify; specced in `.harness/changes/2026-07-02-multimodal-hardening-p3-fusion-dedup.md`. Not done
> blind because a wrong dense-retrieval SQL change breaks ALL retrieval.


- **S3.1 [CRITICAL] Separate visual vectors from the shared 1536 text column.** Add a dedicated
  unbounded `visual_vector vector` column (postgres) / equivalent (tidb) via a new forward-only
  migration; store visual-asset projections there with their true dimension; keep text/text-surrogate
  on `dense_vector`. Update the projection repository read/write and schema descriptors.
  - Accept: a 512-dim visual projection round-trips; a text query never touches visual rows.
- **S3.2 [CRITICAL] Dedicated visual dense search leg.** Add `searchVisualDense` that filters
  `type='dense-vector' AND metadata.multimodal.projectionRole='visual-asset'` on `visual_vector`,
  and make the text `searchDense` EXCLUDE visual-asset rows. Wire the visual query embedder to this
  leg only; fuse as a separate late-fusion leg with per-`nodeId` dedup.
  - Accept: text and visual legs are queried with their own vectors/columns; no cross-space scoring.
- **S3.3 [HIGH] Fix the ANN index opclass.** Add a cosine HNSW index (`vector_cosine_ops`) matching
  the `<=>` query for both `dense_vector` and `visual_vector`.
- **S3.4 [MED] RRF per-leg `nodeId` dedup.** Collapse duplicate projections of the same node within
  a leg before RRF scoring so a node is not double-weighted.
- **S3.5 [MED] Honest `queryMode`.** Either implement real runtime fallback (try visual leg, fall
  back to text when no visual projections) or rename/reduce to the modes actually supported, and fix
  the metrics (`multimodalCandidates`/`visualEmbeddingCandidates` de-dup).

## Phase 4 — Main answer path multimodal

- **S4.1 [HIGH] Thread multimodal through the LLM answer generator.** Make the primary
  `createLlmAnswerQueryGenerator` branch accept and use `multimodalAnswerProvider`,
  `multimodalCandidateResolver`, and the multimodal evidence assembly (or unify the two generators),
  so configuring a VLM provider actually takes effect alongside an LLM answer generator.
- **S4.2 [HIGH] Instantiate `DocumentMultimodalCandidateResolver` in apps/api** and pass it into the
  query generator so citations gain `manifestItemId`/asset route/page/bbox.
- **S4.3 [HIGH] VLM failure falls back to the text answer** — wrap the multimodal provider call in
  try/catch and degrade to `hybridEvidenceAnswer`, recording the failure in trace metadata.
- **S4.4 [MED-HIGH] Carry OCR/caption/textPreview into multimodal evidence** and into both the text
  fallback prompt and the VLM prompt, so text-only providers actually get visual text.
- **S4.5 [LOW] VLM total payload budget.** Bound cumulative (base64-adjusted) attachment bytes, not
  just per-image and count.
- **S4.6 [LOW] Memoize the candidate resolver's manifest build** per (documentAssetId, version)
  within a single answer to remove the per-citation N+1 rebuild.

## Phase 5 — Ingestion correctness

> Status: S5.4 (P2), S5.5, S5.6, S5.7 landed. S5.1/S5.2/S5.3 deferred — structural core-ingestion
> changes with subtle multi-repo delete/rollback and provider-contract semantics that can corrupt
> good data if wrong; need integration tests against real repos. Specced in
> `.harness/changes/2026-07-02-multimodal-hardening-p5-ingestion.md`.


- **S5.1 [CRITICAL] Don't mask projection failures.** Build projections BEFORE (or transactionally
  with) committing the artifact, or record a projection-incomplete state so a retry rebuilds instead
  of hitting the hash-unchanged short-circuit.
- **S5.2 [HIGH] Clean up prior version on re-ingestion.** Delete or supersede a document's previous
  nodes/projections (or enforce the published-fingerprint gate) so stale + new content don't co-exist
  in retrieval.
- **S5.3 [HIGH] Partial visual-asset resilience.** Skip individual unreadable/oversized assets
  instead of failing the whole batch; emit per-asset skip metrics.
- **S5.4 [HIGH] Enrichment cache freshness includes model/promptVersion/provider.** Fold these into
  the freshness check (and/or the manifest/cache key) so a model or prompt change invalidates.
- **S5.5 [MED] Enrichment merge must not downgrade good data.** Preserve an existing object-backed
  `assetRef`/`visualEmbedding: "provided"` unless the provider returns a strictly better value.
- **S5.6 [MED] Bounded (non-fatal) asset extraction + orphan cleanup.** Stop at the cap without
  throwing, and clean up already-written objects when a document ultimately fails.
- **S5.7 [LOW] Don't fabricate `assetRef` from unrelated element metadata** in the manifest builder;
  require a real `assetRef` object (objectKey or explicit asset uri) before marking `asset:provided`.

## Sequencing

Phase 1 → 2 → 3 → 4 → 5. Phases 1/2/5-late are low-risk and self-contained; Phase 3 carries a DB
migration (highest blast radius) and Phase 4 rewires the answer path. Within a phase, land slices in
listed order. Update this doc's checkboxes and write a `.harness/changes` entry per commit.
