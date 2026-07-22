# Website-crawl content-hash dedup (+ superseded-document cleanup)

Date: 2026-07-08

Closes the long-deferred crawl dedup gap, which scheduled sync had amplified: every crawl used to
materialize a new document for every page, unchanged or not.

## How it works (`source-crawl-sync.ts`, shared by the crawl endpoint AND the scheduled runner)
- Per-URL state `metadata.crawled: { [url]: { documentAssetId, sha256 } }`.
- Each crawled page's content is hashed (sha256 of the markdown bytes):
  - **unchanged** (same URL + same hash) -> skipped, prior document kept;
  - **changed** -> re-materialized, and the superseded document is **cascade-deleted** via the new
    `SourceDocumentDeleter.deleteDocuments` (stale-version cleanup);
  - **new** -> imported.
- Pages that disappear from a crawl keep their document + state entry (no delete-on-absence).
- Crawl filenames now carry an 8-char content-hash suffix (`Guide-1a2b3c4d.md`) so same-title pages
  fold back into the state without collisions (same pattern as online-document pageId suffixes).
- Crawl response + `metadata.sync` gain `skipped` / `replaced` counts (additive schema change).

## Blast radius
- `crawledPageToDocument`/old `crawledPageFilename` removed from source-handlers (moved into the
  crawl-sync module with the suffix change) — both were exported only on this branch.
- Filenames of newly crawled documents change (hash suffix). Existing documents are untouched;
  first re-crawl of a pre-dedup source sees no `crawled` state, so it imports everything once more
  (one final duplication round) and dedupes from then on.
- `SourceDocumentDeleter` gained a required `deleteDocuments` method (only the factory implements
  the interface; no literal mocks existed).

## Tests
- `source-crawl-sync.test.ts`: new/skip/replace triage incl. deleter calls + state fold, no-deleter
  fallback, filename collision safety, state reader.
- runner web test: second sync with identical content -> `imported 0 / skipped 2`.
- gateway e2e crawl test: re-crawl returns `{imported: 0, replaced: 0, skipped: 2}` and the space
  still has exactly 2 documents.
