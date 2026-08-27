# Spreadsheet image row placement

## What changed

- Advanced the Unstructured parser policy to `unstructured@8` and added bounded OOXML drawing
  relationship inspection for XLSX-family archives.
- Preserved each embedded image's worksheet, source row, and source column, and projected image
  offsets onto the corresponding canonical table-record text span.
- Kept images with missing, ambiguous, malformed, external, or blank-row anchors unpositioned
  instead of guessing a record.
- Exposed the manifest item's parse-element identity through the Console response so the reading UI
  can suppress a duplicate image-only retrieval node when the same asset is already rendered next
  to its source record. Retrieval nodes remain intact in the index and model source list.

## Why

The archive fallback previously extracted only `xl/media/*`. It discarded worksheet drawing
anchors, so every spreadsheet image reached the document page without a source location and was
rendered in the document-level fallback gallery. Semantic image nodes were also shown as separate
content chunks, duplicating the same image after it was materialized.

## Safety boundaries

- OOXML metadata is read during the existing ZIP pass with per-file, file-count, and aggregate byte
  limits. External relationships, traversal targets, unsupported media, and malformed XML are
  ignored.
- A source row is attached only when exactly one table matches the worksheet by normalized name or
  page and the row maps to a trusted semantic table record. Empty worksheet rows are accounted for.
- Multiple images on one row remain separate manifest items at the same record offset. Unreferenced
  media remains available in the fallback gallery.
- Existing published revisions are immutable; reindexing creates a new parser artifact before the
  corrected placement becomes visible.

## Verification

- Parser tests cover empty worksheet rows, multiple images on one record, multiple sheets,
  one-cell and two-cell anchors, malformed/external relationships, orphan media, and malformed ZIP
  fallback.
- `pnpm --filter @knowledge/parsers test:coverage` — 75 passed; 96.46% statements/lines, 90.45%
  branches, and 98.71% functions.
- `pnpm --filter @knowledge/api exec vitest run src/document-multimodal-manifest-builder.test.ts`
  — 7 passed.
- `pnpm --filter @knowledge/api test` — 4,656 passed and 3 environment-dependent tests skipped.
- Web document-detail model and page suites — 83 passed.
- Dify KnowledgeFS controller suite — 35 passed.
- KnowledgeFS Parser/API, Dify contracts, and Web typechecks passed.
