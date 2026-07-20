# Knowledge data sources P2b — server-side materialization of crawled pages

Date: 2026-07-03

Crawled web pages are now materialized into indexed documents server-side, reusing the exact
ingestion pipeline uploads use.

## What landed

- **`document-compilation-pipeline.ts`** — extracted the synchronous ingestion tail
  (`compileDocumentArtifact`) from the upload handler: parse → PDF rasterize → multimodal extract →
  outline + knowledge paths → projections (or `artifacts.create` when no synchronous reindexer) →
  artifact segments. It deliberately does **not** own the staged-commit lifecycle or parser-status
  transitions — those stay with each caller. The `createArtifactSegments` + `artifactSegmentTypeForElement`
  helpers moved here too.
- **Upload handler refactor** (`document-write-handlers.ts`) — the ~147-line inline block is replaced
  by a single `compileDocumentArtifact(...)` call inside the existing try/catch, so the staged-commit
  transitions, `updateParserStatus`, and error handling are unchanged. This is a faithful move; the
  existing upload test suite (`gateway-document-write.test.ts`) is the regression guard.
- **`source-document-materializer.ts`** — `createSourceDocumentMaterializer` stores each source
  document's bytes, creates a `DocumentAsset` (carrying `sourceId` + provenance metadata), runs
  `compileDocumentArtifact`, then marks it `parsed`. Per-document failures are isolated: the asset is
  marked `failed` and reported in `failed[]` rather than aborting the batch.
- **Crawl endpoint** now materializes: `POST …/sources/{sourceId}/crawl` maps each crawled page to a
  `text/markdown` document (`dataSourceType: "website_crawl"`, `dataSourceInfo: {url,title}`), imports
  them, and returns `imported`/`failed` counts (also recorded in `metadata.sync`). The materializer is
  built once in the gateway from the same deps the upload handler uses.

## Notes / limits

- Materialization is **synchronous** within the crawl request (bounded by the crawl limit); no quota
  admission or staged-commit lifecycle is applied to source-materialized documents (those are
  upload-path concerns). A future pass can add quota + async handoff.
- Because `documentCompilationJobs` is unwired in apps/api, this synchronous path is what actually
  runs; when a synchronous reindexer is absent (no compute) the pipeline persists the artifact + FTS
  segments so documents are still retrievable.

## Tests

- `source-document-materializer.test.ts` — per-document failure isolation (parser throws → asset
  `failed`, reported in `failed[]`, batch continues).
- `gateway-source.test.ts` — crawl happy path now asserts `imported: 2, failed: 0`, `metadata.sync`,
  and that two documents exist carrying the `sourceId` (full end-to-end via the in-memory gateway +
  default markdown parser).
- Existing `gateway-document-write.test.ts` guards the extraction (unchanged upload behavior).

Not run here — run `pnpm check`.
