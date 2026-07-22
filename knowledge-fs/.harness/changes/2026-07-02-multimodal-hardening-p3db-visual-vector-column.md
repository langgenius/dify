# Multimodal hardening P3-DB — visual_vector column + cosine index + leg isolation

Date: 2026-07-02

Implements the storage half of the deferred P3 visual-retrieval work. **Needs `pnpm check` (incl. the
migration drift test) + a live Postgres/TiDB to fully validate** — no runtime here.

## Schema (`schema.ts` + re-rendered `0001_initial_schema.{postgres,tidb}.sql`)

- Added a nullable, unbounded-dimension `visual_vector` column to `index_projections` (holds
  image-byte visual embeddings of any model dimension — the fixed `dense_vector vector(1536)` could
  never store non-1536 visual vectors).
- Changed the `dense_vector` HNSW opclass from `vector_l2_ops` to `vector_cosine_ops` so it matches
  the `1 - (dense_vector <=> $q)` cosine query (the L2 index could not serve `<=>`, forcing seq
  scans).
- Added an `index_projections_visual_vector_hnsw_idx` cosine HNSW index for the visual leg.

The `.sql` artifacts were hand-edited to exactly match `renderMigrationSql` output (column position,
index order, dialect formatting) so the drift test stays green.

## Vector-space routing (regression-free)

The builder now tags each visual projection with `metadata.multimodal.vectorSpace`:
`"visual"` for image-byte embeddings (`:image-bytes` provider), `"text"` for text-surrogate
embeddings (which share the text embedding space). The repository routes the vector by that tag:
- text + **text-surrogate visual** → `dense_vector` (they stay in the text dense leg — same space,
  no recall regression);
- **image-byte visual** → `visual_vector` (separate space).

`indexProjectionInsertPlaceholder` casts `visual_vector` like `dense_vector`.

## Query isolation

`searchDense` (text leg) now filters `dense_vector IS NOT NULL`, so image-byte visual rows (which
have a NULL `dense_vector`) can never be scored by a text query — closing the cross-embedding-space
scoring the audit flagged. A new `searchVisualDense` (optional repo method) scores the
`visual_vector` column for the visual leg; both share one `runVectorSearch` helper. `RetrievalSource`
gains `"visual"`.

## Scope

This lands the storage + isolation. Activating image-byte visual RETRIEVAL (running `searchVisualDense`
as a fused leg with a visual query vector, wired through the generators + apps/api) is the next slice.
Until then the visual leg is stored and isolated but not yet queried — with no regression, because
text-surrogate visual retrieval continues through the text leg.

## Tests

`database-sql-utils.test.ts` (visual_vector cast), `index-projection-repository.test.ts` (routing:
text→dense_vector, image-byte→visual_vector). Reasoned-verified; run `pnpm check`.
