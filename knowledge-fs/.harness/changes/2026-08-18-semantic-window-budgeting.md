# Semantic window budgeting and short-record chunking

Date: 2026-08-18

## Iteration plan

1. Establish deterministic before/after baselines with the same parser output and configuration.
   Count parser elements, atomic semantic units, section paths, tables, planned model windows, and
   final retrieval chunks separately so request reduction is not confused with chunk reduction.
2. Introduce a versioned semantic-window planner. Keep every pre-existing prompt version on the
   legacy planner and opt only the new `semantic-chunking-v2` prompt into context-budgeted windows.
3. Stop treating parser `sectionPath` values and table/image boundaries as model-request
   boundaries. Preserve table/image isolation as a final retrieval-chunk invariant for ordinary
   documents.
4. Detect one-page, one-table structured records that fit inside one chunk and compile them as one
   atomic fact. Require one complete model range and reject partial or multi-chunk responses.
5. Preserve downstream correctness by recording the exact source element, type, page, byte range,
   and parser section path for every semantic chunk. Continue deriving summaries, Graph facts, node
   kinds, and citations from immutable source ranges.
6. Carry the prompt version into preflight and replay so durable v1 jobs retain their original
   window fingerprints. Validate window/chunk caps, special-element isolation, exact source spans,
   compact receipts, and provider completion bounds.
7. Run focused and complete API regressions, type and format gates, then repeat the baseline with
   the same local inputs. Report only deterministic measurements; do not extrapolate provider
   latency before a deployed re-import.

## What changed

- The default prompt is now `semantic-chunking-v2`. Its model requests are filled by the configured
  `maxWindowChars` budget across adjacent parser sections and special elements. `sectionPath` is
  supplied per unit as provenance instead of forcing another provider call.
- Tables and images still cannot be mixed into an ordinary text retrieval chunk. The model can see
  the surrounding document in one request, but response validation requires every isolated element
  to occupy its own final range.
- A short structured-record classifier activates only when the complete document fits
  `maxChunkChars`, contains exactly one table plus narrative content, and has exactly one known
  source page. In that mode the table is part of one record, and both generation and replay require
  exactly one window and one chunk.
- Every v2 node stores `semanticChunking.sourceSpans` with immutable element ids, element types,
  UTF-8 byte offsets, page numbers, and original section paths. `windowPlanning` records the planner
  version, atomic-record decision, and source-path count.
- The prompt gives each v2 unit a `sourceElementId`, `sourceSectionPath`, and optional isolated
  boundary marker. PageIndex paths use the longest trusted common source prefix; semantic child
  paths and summaries remain model decisions. Graph entities and relations remain exact-substring
  grounded against the materialized chunk text.
- Preflight now accepts `promptVersion`, and generation-receipt admission passes the frozen version
  through. Any prompt version other than the new exact v2 identifier keeps legacy planning, which
  preserves custom and default v1 receipt fingerprints.

## Correctness invariants

- Model output never supplies authoritative text. Final text and offsets are sliced from immutable
  parser units, with contiguous full-document coverage and no overlap.
- Normal-document table/image isolation is enforced after model output, not trusted to the prompt.
- Atomic-record mode requires exactly one page, one table, narrative text, one window, and one
  chunk; larger or ambiguous documents use normal planning.
- V2 replay recomputes and compares every source span. V1 replay deliberately retains its previous
  marker and fingerprint contract.
- Window, node, response, entity, relation, and completion-catalog limits remain enforced before or
  during model materialization.

## Measured results

All comparisons use the same current parser output and configuration; only the frozen planner
version changes.

- Supplied HTML: 102,516 input bytes, 10,522 parsed characters, 171 parser elements, 68 distinct
  section paths, 7 tables, and 232 atomic units. Legacy planning produces 80 model windows; v2
  produces 3. Deterministic model-call reduction: **96.25%**. Unit count remains 232.
- Supplied one-page invoice: PDF inspection confirms one 154,118-byte page containing one invoice
  record and one line-item table. A regression artifact matching that structure produces 3 legacy
  windows (text/table/text) and 1 v2 atomic window/chunk. Deterministic model-call and retrieval-node
  reduction for this shape: **66.67%**.
- No end-to-end model latency percentage is claimed. Provider queueing, token throughput, retries,
  and network time require a deployed re-import with stage metrics; call-count reduction alone is
  not converted into invented elapsed-time savings.

## Verification

- Semantic chunker regression: 38 tests passed, including v1/v2 window bounds, one-page atomic
  records, multi-section batching, special-element isolation, source spans, Graph grounding, compact
  receipt replay, and cap enforcement.
- Focused semantic/reindex suite: 2 files and 48 tests passed.
- Complete `@knowledge/api` suite: 412 files passed, 1 skipped; 4,547 tests passed, 3 skipped.
- Complete `pnpm --dir knowledge-fs check` passed, including all workspace typechecks/tests, CI
  coverage, retrieval evaluations, migration and contract exports, Compose checks, rollout guards,
  and static image smoke tests.
- The informational full API coverage run executed all tests and reports 97.28% statements/lines,
  92.25% branches, and 98.50% functions for `llm-semantic-chunker.ts`. The API package's global
  branch total remains 89.33%, below its standalone 90% threshold; the normal repository CI
  coverage gate intentionally excludes that historical package-wide baseline and passed.
- `@knowledge/api` typecheck, focused Biome checks, contract-lock verification, and
  `git diff --check` passed.

## Rollout and follow-up

- Existing v1 receipts remain replayable and do not make another provider call. Only newly created
  default semantic compilations use v2 planning.
- After deployment, re-import the two measured files and compare semantic-window call count, input
  and output tokens, semantic-stage wall time, retry count, and retrieval quality against the
  recorded baseline. Real elapsed-time improvement should be reported only from that run.
- The atomic classifier intentionally fails closed for unknown-page, multi-page, and multi-table
  inputs. Expanding it should be driven by a labeled structured-record corpus rather than filename
  or MIME heuristics.
