# Multimodal hardening P5 (cont.) — partial visual-batch resilience (S5.3)

Date: 2026-07-03

## S5.3 — one unreadable asset no longer fails the whole visual batch

`createObjectStorageVisualEmbeddingProvider.embedAssets` used `Promise.all` over
`readVisualEmbeddingImage`, so a single missing/oversized/unreadable object threw and the builder's
count-mismatch check aborted the entire batch — a document with 50 image assets lost ALL visual
projections because of one bad object.

- The object-storage provider now reads assets individually, skips the ones that fail, and reports
  `embeddedNodeIds` (aligned with `dense`) on `EmbedVisualAssetsResult`.
- The projection builder, when `embeddedNodeIds` is present, maps vectors back by `nodeId` and builds
  projections only for the embedded assets (falling back to the strict index-aligned contract
  otherwise). It returns `[]` when nothing was embeddable.

Test: `index-projection-builders.test.ts` — two image nodes, one object present and one missing; one
image is embedded and exactly one projection is built for the readable node.

## Still deferred — S5.1 / S5.2 (reindexer failure-masking + stale cleanup)

Investigated further; still not safe to land blind:

- **S5.2 (stale prior-version projections).** The system already has a version mechanism
  (`publishVersion` / `pruneInactiveVersions` / `rollbackVersion`) and a retrieval-side
  `filterRetrievalCandidatesByProjectionSet` gate keyed on a `publishedFingerprint`. The clean,
  non-destructive fix is to make the projection builders populate
  `metadata.projectionSetFingerprint` and wire `publishVersion` so the existing gate hides
  superseded versions — but that touches the version/fingerprint contract used by ALL retrieval and
  must be validated against a live DB.
- **S5.1 (projection-failure masking).** A durable fix needs either a projection-complete marker
  gating the `artifact-hash-unchanged` short-circuit, or a rollback of the just-created
  nodes/projections/artifact on failure. The repos only expose coarse `deleteByDocumentAsset` (no
  per-run scope, no transaction), so a naive rollback can delete good prior-version data — strictly
  worse than the current bug. Needs transaction support or the version-gate above, plus integration
  tests.

Landing these two destructively without a runtime would risk data loss, so they remain specced.

Run `pnpm --filter @knowledge/api test` + `pnpm check`.
