# Document compilation memory bounds

## What changed

- Replaced per-fragment parser-metadata cloning with a shared, format-independent source-element
  reference during both LLM semantic chunking and deterministic chunking.
- Added one bounded metadata projection for final knowledge nodes. Fragments retain compact source
  references and coordinates, while large OCR, table, and HTML payloads are not duplicated onto
  every derived node. Complete elements retain compatible rich metadata up to a 256 KiB budget.
- Replaced repeated prefix slicing and UTF-8 re-encoding in semantic unit materialization with a
  monotonic byte cursor.
- Stopped retaining Unstructured's raw `text_as_html` field after it has been normalized to the
  existing `textAsHtml` / table representation, and advanced the default parser policy to
  `unstructured@6` so old and new artifacts cannot share a cache identity.
- Made outline character counting, outline fallback summaries, and LLM summary inputs stream over
  bounded prefixes instead of materializing complete multi-megabyte sections before truncation.
- Added low-heap child-process regressions for semantic and deterministic chunking using the size
  and structure of the reported 2,000-row spreadsheet artifact.

## Why

The spreadsheet parsed successfully, but its first table element contained roughly 631,000 text
characters and 798,000 HTML characters. Semantic preflight split that element into 526 atomic units
and cloned the complete table metadata into every unit. The resulting amplification consumed about
2.60 GiB of heap before the first model call, exceeding the service's roughly 2.20 GiB V8 heap
limit. This was an in-process memory amplification bug, not an XLSX multi-sheet timeout.

The affected code is shared by every parser format. A large HTML table, OCR-heavy PDF, or Office
document could therefore trigger the same failure even when its uploaded file was small.

## Safety boundaries

- Fragment metadata has a 16 KiB serialized budget; complete-element metadata has a 256 KiB
  serialized budget. Omitted fields are recorded deterministically in `sourceMetadataProjection`.
- Parser metadata remains available on the canonical parse artifact; the projection only controls
  repeated knowledge-node copies and does not discard source evidence.
- Compact multimodal references (`assetRef`), bounding boxes, captions, and titles remain eligible
  on fragments, preserving image display, citation location, and retrieval provenance.
- Semantic prompt contents, chunk text, offsets, window sizes, and model-call behavior are unchanged.

## Measured regression

On the production-sized synthetic artifact (631,113 text characters and 797,526 HTML characters):

- semantic preflight produced 526 atomic units and 132 windows under a 128 MiB V8 heap;
- deterministic chunking produced 526 nodes under the same 128 MiB heap;
- the semantic preflight process reported about 32 MiB heap in use after completion.

These are local regression measurements, not projected production latency or throughput numbers.

## Verification

- `pnpm --dir knowledge-fs --filter @knowledge/api exec vitest run --reporter=dot` — 4,650 passed,
  3 skipped.
- `pnpm --dir knowledge-fs --filter @knowledge/core test:coverage` — 61 passed; package coverage
  remained above 90% in every dimension.
- `pnpm --dir knowledge-fs --filter @knowledge/compute test:coverage` — 25 passed; package coverage
  remained above 90% in every dimension.
- `pnpm --dir knowledge-fs --filter @knowledge/parsers test:coverage` — 63 passed; package coverage
  remained above 90% in every dimension.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app test` — 262 passed.
- KnowledgeFS Core, Compute, Parser, and API typechecks passed.
- `pnpm --dir knowledge-fs lint:backend` passed.

## Remaining operational note

The pipeline still intentionally holds one canonical parse artifact and bounded model windows in
memory. Existing upload-size, parser-response, element-count, node-count, model-window, PDF raster,
image-byte, and concurrency limits remain the admission boundaries for unusually large documents.
This change removes the unbounded multiplication by fragment count; it does not claim constant
memory independent of the admitted document size.
