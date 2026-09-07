# Parser hardening — first implementation phase

## Scope and intent

Implement the first phase of the 2026-09-05 parser audit: bound structural amplification, preserve native document content, and prevent incompatible size-based routing. This is not a claim that every parser or every resource-exhaustion vector is now sandboxed. Existing PDF safeguards and the MediaBox consistency follow-up remain in their dedicated change notes.

## Changes

- Office/ODF/EPUB admission streams actual ZIP member expansion before contacting Unstructured, within the existing shared single-flight/admission lifetime. It checks local/central entry agreement, duplicate/unsafe paths, XML structure, worksheet coordinates, shared strings, and logical worksheet references. A repeated worksheet relationship consumes its repeated dense-cell cost. Input bytes and provider partition options are unchanged for admitted files.
- Inspection has explicit defaults: 4,096 members, 512 MiB total actual expansion, 64 MiB total XML / 16 MiB per XML part, depth 128, 1 million XML nodes, 256 logical worksheets, 100,000 rows / 16,384 columns, 250,000 dense cells per sheet / 500,000 per workbook, 500,000 actual cells, 200,000 shared strings, 30-second inspection deadline. Column formatting ranges do not inflate occupied cell span. Standard EPUB 2 XHTML PUBLIC identifiers are allowed without loading DTDs; internal subsets and arbitrary declarations are not.
- Shared native budgets bound decoded structure (250,000 nodes / depth 128), projected output (32 MiB), table width (4,096) and cells (500,000). HTML expansion and table text bytes share a parse-local document-wide counter, including separate Markdown HTML blocks and separate provider table elements; independent parses do not share counters. Final/provider metadata uses a separate 1 million-node budget to accommodate the existing 20,000-element limit and ordinary coordinate metadata. Limits fail explicitly; they never silently truncate content.
- JSON/JSONL retain numeric source tokens, including large integers, precise decimals, exponent notation and negative zero. Node 22's native `JSON.parse` reviver source preserves own `__proto__` fields safely. No new runtime dependency is added. JSONL scalar/null/array records retain their values and source order.
- CSV uses array decoding and own-property record construction; duplicate headers receive collision-free stable names in amortized linear naming work, special property names are preserved, header-only documents retain headers, and absent object fields never read inherited properties.
- Sparse heterogeneous records stay sparse instead of expanding into the union-key Cartesian product. Ordinary homogeneous record tables retain their representation. Table text is byte-budgeted before joins, including header-only output and repeated labels.
- XML attributes and lexical tag values are retained. Untyped XML numeric-looking text is deliberately represented as a string, preventing loss of leading-zero identifiers.
- Structured files stay on the native structured parser when configured. The API uses the same admitted input-byte limit for structured and remote paths (15 MiB default; existing override capped at 50 MiB), so 10–15 MiB JSON/CSV uploads no longer switch to an incompatible remote format.
- Native parsing checks an already-aborted request before decoding. Shared remote normalization uses the coordinator-owned signal, not the first caller's signal, preserving remaining consumers of identical work.
- Content/layout changes advance default parser identities: Markdown/MDX v3, HTML v4, structured v3, Unstructured v11. Existing indexes are not rewritten automatically; subsequent parse/re-index operations use the new policy identity.

The markup fidelity, CJK spatial-index/heading budget, raw provider-response guard, synchronous deadline detection, HTML span budgets, and PDF geometry work are detailed in adjacent change notes.

## Compatibility and security boundaries

- Normal-file content and transport contracts are regression-tested, but newly imposed cost limits intentionally reject exceptionally large or ambiguous structures even when the file format itself permits them. Error classification is terminal input failure before remote work; no retry storm and no remote-acceptance ambiguity is introduced for admission failures.
- Previously permissive test fixtures containing path traversal, malformed ZIP/XML, invalid coordinates or unsafe worksheet relationships are now explicit rejection cases. Safe media-anchor failures remain fail-soft inside a valid admitted archive.
- Standard EPUB declaration support was checked against upstream Unstructured/Pandoc source and archive-based tests; this is not a pinned-Pandoc production round trip.
- Native numeric lexeme support was verified directly on Node **22.0.0**, the minimum major version used by the deployment images, as well as the development runtime.

## Verification

Tests were added and observed failing before behavioral fixes. Focused tests cover ordinary and adversarial inputs, source-byte preservation, special JSON/CSV property keys, cancellation/single-flight behavior, size-routing boundaries, and real Poppler page/crop geometry.

- Final parser suite: **442/442**, coverage **96.81% statements/lines, 91.09% branches, 97.8% functions**; no coverage threshold was lowered.
- Node **22.0.0**: 50 JSON/structured integration tests pass on the deployed major's initial release, not just the newer development runtime.
- API package regression suite: **5,061 passed / 3 existing skipped**, 426 passed test files / 1 existing skipped file. Focused real Poppler rendering/crop tests: **60/60**. API parser configuration/preflight tests: **55/55**.
- Full **`pnpm check` passes**, including all workspace tests, configured CI coverage gates, retrieval/phase-4 regressions, OpenAPI export, migration artifact checks and Compose/static smoke checks. The repository's existing CI coverage command excludes the API package; its complete test suite and focused PDF tests still run as recorded above.
- Full workspace typecheck and **`pnpm build` pass**; backend-scoped Biome passes. `git diff --check` passes. Contract pin/export validation uses an isolated temporary Git index so the user's staging area is not changed.
- Full `pnpm lint` was attempted and remains blocked by pre-existing, untouched Admin/test/generated OpenAPI formatting/file-size findings. Those unrelated files were not reformatted as part of parser work.
- Local diagnostic: the audit's 4,881-byte, 300-record sparse JSON now produces **3,979 bytes** of text (about 4 ms in one bounded run), instead of the audited 1,137,189-character dense projection. This is a regression probe, not a production benchmark.
- Production provider/worker redeployment and live ingestion E2E were not run. Real-pinned-provider corpus benchmarks and server verification remain required before calling the entire optimization roadmap complete.

## Remaining roadmap (not completed by this phase)

- Nested EML/MSG attachments do not yet share recursive admission/depth/budget accounting; attachment behavior is not disabled as a shortcut.
- Legacy DOC/PPT/XLS conversion and native library image decoding still require provider-side process isolation, hard memory/CPU limits and killable work. Format preflight cannot prove arbitrary binary parser safety.
- Native JSON/HTML/XML and Markdown tokenization still allocate in the API process within byte/structure bounds. The new deadline check detects synchronous overruns; it cannot preempt JavaScript execution. XML's structural check is post-decoding; move recursive native work to bounded workers in a later phase.
- Unified encoding policy, complete/partial visual-enrichment reporting, aggregate remote-image budgets, provider-version fingerprinting, cross-process resource admission and production corpus benchmarks remain later phases.
- No database migration, model configuration, production deployment, commit or push is performed by this implementation turn.
