# Multimodal hardening P3 — fusion/metric dedup (+ DB follow-up spec)

Date: 2026-07-02

## Landed (pure TS, verifiable)

### S3.4 — RRF per-leg node dedup (`retrieval-fusion.ts`)

A node with two dense projections (e.g. a text-surrogate AND a visual-asset projection) appeared
twice in the dense leg, and `addCandidate` added a separate `1/(rrfK+rank)` contribution for each,
double-weighting multimodal nodes purely for having two projections. Now each leg is collapsed to one
entry per `nodeId` (candidates are score-ordered, so the first occurrence is the node's best rank),
with correct node-position ranks; dropped duplicates' projection ids are still retained on the item.

### S3.5 (metrics) — distinct-node multimodal counts (`hybrid-retrieval.ts`)

`multimodalCandidates` / `visualEmbeddingCandidates` counted over `[...dense, ...fts]`, double-counting
a node retrieved by both legs. They now count DISTINCT `nodeId`s.

Tests: fusion same-leg-duplicate collapse; existing cross-leg test still passes.

## Deferred — requires a live DB + the migration renderer (NOT done blind)

The remaining Phase 3 items touch the vector schema. Migrations here are **rendered from
`schema.ts`** (`renderMigrationSql`) into `0001_initial_schema.{postgres,tidb}.sql`, guarded by an
exact-output drift test, and the SQL/HNSW behavior can only be validated against a real
Postgres/TiDB. Landing these blind risks breaking ALL dense retrieval, so they are specced here for a
DB-enabled pass:

- **S3.1 — dedicated `visual_vector vector` column.** Add a nullable unbounded-dimension
  `visual_vector` column; route visual-asset projections there (leave `dense_vector` NULL for them);
  update `denseVectorParam`/the repository insert to pick the column by `projectionRole`. Re-render
  the 0001 artifacts. Fixes: image-byte models of any dimension (currently `vector(1536)` rejects
  non-1536 visual vectors on insert, so real visual indexing silently never materializes).
- **S3.2 — separate visual dense leg.** `searchDense` (text) filters `dense_vector IS NOT NULL`
  (naturally excludes visual rows once S3.1 lands); add `searchVisualDense` filtering
  `visual_vector IS NOT NULL` scored on `visual_vector`; wire the visual query embedder to that leg
  only and fuse it as a distinct late-fusion leg (reusing the S3.4 dedup). Removes the last cross-
  embedding-space scoring path (`queryMode=primary` today scores a visual query vector against text
  rows).
- **S3.3 — cosine ANN index.** The HNSW index uses `vector_l2_ops` but the query is cosine (`<=>`),
  so dense retrieval currently seq-scans. Change the `schema.ts` operator class to
  `vector_cosine_ops` (and add one for `visual_vector`); re-render artifacts.
- **S3.5 (queryMode) — honest runtime fallback.** With the separate visual leg in place, implement
  real "try visual, fall back to text" semantics (or reduce the mode surface to what is supported);
  today `fallback` is resolved statically at startup and never uses the visual embedder when text
  embeddings exist.

Note on current impact: with today's `vector(1536)` column, non-1536 visual vectors cannot be
inserted at all, so the audited "text query crashes on dimension mismatch" cannot occur in the
default config — the real current-state bugs are the double-counts fixed above. The deferred work is
feature-completion (make real image-byte visual retrieval actually function), which needs DB
verification.

Run `pnpm --filter @knowledge/api test` + `pnpm check` for the landed changes.
