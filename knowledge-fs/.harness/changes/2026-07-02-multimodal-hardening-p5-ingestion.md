# Multimodal hardening P5 — ingestion correctness

Date: 2026-07-02

## Landed

### S5.5 — enrichment merge must not downgrade good data (`document-multimodal-manifest-enhancer.ts`)

`assetRef = result.assetRef ?? item.assetRef` replaced a real object-backed assetRef with a weaker
(uri-only) provider result, and `visualEmbedding`/`tableStructure` let a provider `"missing"`
overwrite an existing `"provided"`. Now `pickBetterAssetRef` keeps an object-backed assetRef unless
the provider returns one with an objectKey, and `preferProvidedStatus` never downgrades `"provided"`.

### S5.6 — soft asset-extraction cap (`document-multimodal-asset-extractor.ts`)

Hitting `maxExtractedAssets` threw mid-loop, aborting ingestion and orphaning the objects already
written this run. It now stops extracting at the cap, leaves the remaining images inline, and reports
`skippedForCapCount` (also surfaced in `metadata.multimodalAssets`).

### S5.7 — no fabricated assetRef (`document-multimodal-manifest-builder.ts`)

`parseAssetRef` fell back to reading `objectKey`/`uri`/`sha256`/`mimeType` off the WHOLE element
metadata when there was no `metadata.assetRef`, so a generic `uri` (source hyperlink) or `mimeType`
fabricated a fake asset marked `asset: "provided"`. It now only builds from an explicit
`metadata.assetRef` object, or from top-level metadata that carries a strong asset signal
(`objectKey`/`sha256`) — never from a bare `uri`/`mimeType`.

### S5.4 — (landed in P2) cache freshness includes model/promptVersion.

## Deferred — structural, needs integration tests against real repos (NOT done blind)

These touch core ingestion; a wrong delete/rollback can corrupt good data, and there is no runtime
here to verify multi-repo semantics. Specced for a follow-up:

- **S5.1 — reindexer masks projection failures.** The artifact is committed before projections are
  built; a projection failure aborts the run but the retry hits the `artifact-hash-unchanged`
  short-circuit and never rebuilds (silent zero-projection document). Fix needs either a
  projection-complete marker gating the short-circuit, or a best-effort rollback (delete the
  just-created nodes/projections/artifact) on failure. The node repo only exposes
  `deleteByDocumentAsset` (coarse — would also drop a prior good version), so this must be designed
  and integration-tested carefully.
- **S5.2 — re-ingestion leaves stale nodes/projections.** A changed re-ingest creates new
  nodes/projections without superseding the prior version's `ready` ones, so retrieval mixes old and
  new. Needs a version-supersede/delete step (or enforcing the published-fingerprint gate, which the
  builders don't currently populate) — coupled to S5.1's delete semantics.
- **S5.3 — partial visual-asset batch failure.** `createObjectStorageVisualEmbeddingProvider` uses
  `Promise.all` + a builder count-mismatch check, so one unreadable/oversized asset fails the whole
  visual batch. A resilient version needs the provider to report which assets it embedded and the
  builder to create projections only for those (a contract change), verified end-to-end.

## Tests

Enhancer: assetRef no-downgrade. Extractor: soft-cap (extractedCount==cap, skippedForCapCount,
over-cap image left inline, exactly one object written — no orphan). Builder: no fabrication from
generic `uri`/`mimeType`, real top-level `objectKey` still recognized. Not run here — run
`pnpm --filter @knowledge/api test` + `pnpm check`.
