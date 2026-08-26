# Structured table semantic chunking

## What changed

- Kept spreadsheet, CSV, JSONL, Markdown, HTML, and Unstructured table elements typed as
  `table`, but added a versioned semantic projection containing bounded columns, header and source
  row counts, record count, and one of `record-list`, `single-record`, `matrix`, or `unknown`.
- Canonicalized each logical table record as one field-labelled line. Embedded newlines stay inside
  their source record, duplicate or blank headers receive stable names, multi-row HTML headers and
  bounded row/column spans are flattened deterministically, and worksheet metadata remains attached
  to its own table element.
- Advanced native Markdown/MDX, HTML, structured-data, and Unstructured parser versions so the new
  projection cannot collide with an older cached artifact.
- Added `semantic-chunking-v5`. Reliable record-list and matrix rows become semantic atomic units;
  the prompt receives a table schema once per window plus record indexes and source-row provenance.
  A deterministic post-processor splits any model response that groups separate records, while a
  single overlong record may still be hard-split to respect the existing 1,200-grapheme limit.
- Kept `semantic-chunking-v4` replay behavior unchanged. Legacy structured artifacts with the old
  header-first text plus `rowCount` are recognized without requiring a reparse.

## Why

The reported workbook was parsed as one table element, but its flattened text had no stable record
boundaries for semantic chunking. The model could legally return the complete worksheet as one
chunk. Prompt wording alone could not make this reliable because parser structure had already been
discarded.

The fix makes row/record boundaries trusted parser provenance. The LLM can still enrich sections,
summaries, entities, and relations, but it can no longer merge independent business records from a
record list or matrix.

## Memory and token boundaries

- Table schemas are serialized once per semantic window, not once per row, and are not copied onto
  every output knowledge node. Field names remain in chunk text, so independent chunks retain their
  retrieval meaning.
- Projection builds output lines in one pass instead of retaining a second normalized row matrix.
- Columns are capped at 64 names and 160 characters per name in the semantic planner. Existing
  parser input, row, element, response, node, window, and heap admission limits remain in force.
- A low-heap regression preflights 2,000 structured records as 2,000 units and 65 bounded windows
  under a 128 MiB V8 heap. The existing production-sized flattened-table regression still passes
  under the same heap limit.

## Measured sample result

Read-only inspection of `dify使用问题反馈.xlsx` found one worksheet, 329,567 uploaded bytes, eight
populated rows (one header plus seven records), seven business columns, and a longest cell of 66
characters. With the v5 projection, the seven records preflight as seven units in one semantic
window, so segmentation requires one model request and deterministically produces seven record
chunks even if the model groups them. Local preflight took 6.741 ms and reported 12,060,344 bytes of
heap after module initialization.

Those figures describe local structural preflight only. They are not claims about end-to-end import
latency, provider latency, embedding time, or production throughput.

## Compatibility and rollout

- Newly parsed documents use the new parser and prompt versions automatically.
- Old structured CSV/JSONL artifacts with `columns` and `rowCount` gain record splitting during a
  new semantic generation without reparsing.
- Older provider artifacts that contain only irreversibly flattened table text and no HTML or row
  metadata remain `unknown`; they are not guessed into records and need reindex/reparse to gain the
  richer projection.
- No database migration or public HTTP contract change is required.

## Verification

- Parser tests cover native CSV/JSONL, Markdown, HTML, representative Unstructured XLSX, multiple
  worksheets, quoted CSV newlines, empty/headerless/key-value/matrix tables, duplicate headers, and
  bounded HTML spans.
- Semantic tests cover model grouping correction, long-record hard splitting, legacy row recovery,
  v4 replay compatibility, prompt-schema deduplication, offsets, and low-heap admission.
- `pnpm --dir knowledge-fs --filter @knowledge/parsers test:coverage` — 72 passed; 96.25% statement
  and 90.04% branch coverage.
- `pnpm --dir knowledge-fs --filter @knowledge/api test` — 4,656 passed, 3 skipped.
- Parser and API typechecks passed.
- `pnpm --dir knowledge-fs lint:backend` passed across 1,081 files.
- The KnowledgeFS contract lock was regenerated and checked after the staged subtree review.
