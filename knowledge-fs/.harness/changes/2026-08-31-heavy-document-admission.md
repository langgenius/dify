# KnowledgeFS format-aware heavy-document admission

## What changed

- Replaced the parser client's PDF-only execution gate with a format-aware heavy-document policy.
  It covers all product-supported remote formats: DOC/DOCX, PPT/PPTX, XLS/XLSX, ODT/RTF,
  EML/MSG, EPUB, and PDF.
- Accounted for the complete product upload contract rather than the parser package's broader
  internal capabilities. The 25 supported extensions are CSV, DOC, DOCX, EML, EPUB, HTM, HTML,
  JSON, JSONL, MARKDOWN, MD, MDX, MSG, ODT, PDF, PPT, PPTX, PROPERTIES, RTF, TEXT, TXT, VTT, XLS,
  XLSX, and XML. Native text/HTML/structured routes remain semantically unchanged but now share the
  cross-format materialization admission boundary; inputs above the native 10 MiB threshold use
  the bounded remote route.
- Preserved every PDF on the heavy path. Compressed PDF object streams can hide page-tree markers,
  so a bounded byte scan is not reliable enough to shorten an existing PDF deadline.
- Classified non-PDF requests as heavy when the body exceeds 8 MiB or when a bounded ZIP central
  directory declares substantial structure (entry count, expanded bytes, markup bytes, slide
  count, or worksheet count). The inspection never inflates ZIP entries.
- Routed compact legacy DOC/PPT/XLS, RTF, EML, and MSG through the heavy lane as well. Those opaque
  containers do not expose a cheap, trustworthy page/slide/row/attachment count, so compressed
  bytes alone cannot prove that even the ordinary ten-minute deadline is sufficient.
- Rejected classic ZIP metadata that declares ZIP64/multi-disk input, excessive central-directory
  state, more than 4,096 entries, more than 512 MiB expanded content, or an extreme compression
  ratio before starting provider work. A ZIP signature without a valid bounded central directory
  is isolated in the heavy lane rather than the standard lane: this preserves existing recovery of
  primary provider text when optional Office media metadata is malformed while bounding such work
  to the dedicated service and one heavy request at a time.
- Hardened end-of-central-directory discovery against forged EOCD records, legal prepended/SFX
  stubs, misleading legacy filename/MIME metadata, and trailing garbage accepted by tolerant ZIP
  readers. Canonical candidates account for the exact trailing comment; non-canonical candidates
  are still inspected for declared expansion hazards but can never earn the standard lane, and
  multiple plausible candidates are treated as hazardous.
- Avoided treating compression ratio alone as proof of a ZIP bomb. Highly repetitive but bounded
  worksheet/document XML is isolated as heavy; it is rejected only when high compression is paired
  with a large absolute entry expansion, or when the archive exceeds the total expansion ceiling.
- Treat filename, normalized MIME type, and bounded file magic as independent, untrusted signals.
  Any PDF signal remains heavy, every apparent ZIP gets central-directory inspection, and
  conflicting known non-PDF filename/MIME signals use the heavy lane instead of MIME-first routing.
- Added generic `UNSTRUCTURED_HEAVY_MAX_CONCURRENCY` and
  `UNSTRUCTURED_HEAVY_REQUEST_TIMEOUT_MS` controls. The old `UNSTRUCTURED_PDF_*` names remain
  lower-precedence compatibility aliases. Execution-only knobs remain outside parser policy and
  artifact fingerprints.
- Increased the ordinary Unstructured request deadline from 120 seconds to 600 seconds. Heavy
  documents retain their separate 2,400-second deadline and concurrency lane.
- Removed two avoidable full-input allocations from every parser request: artifact digests now
  stream the policy prefix and admitted document bytes into SHA-256, and multipart construction
  reuses an `ArrayBuffer`-backed admitted view instead of slicing the whole source first. The
  stable-digest regression locks byte-for-byte artifact identity across this implementation change.
- Added `UNSTRUCTURED_MAX_INPUT_BYTES`, defaulting to 15 MiB and capped at 50 MiB. Native routing
  remains at 10 MiB, so product-valid 10–15 MiB CSV/JSON/XML/HTML/Markdown inputs now route to and
  are admitted by the remote parser rather than failing after upload.
- Aligned the direct-upload session default, multipart threshold, and bounded Dify-storage fallback
  at 15 MiB. A file exactly at the threshold remains a single upload, and the fallback may equal
  (but never exceed) that threshold. This matters because the integrated Dify object-storage
  adapter intentionally has no provider-specific multipart credentials; 8–15 MiB staged files must
  still be adopted from Dify storage instead of being rejected before compilation.
- Removed upload-size mappings from Compose's `service.environment`; those mappings overrode the
  later operator-owned `knowledge-fs.env`. Code/image defaults still provide 15 MiB when the file is
  absent. Direct KnowledgeFS clients can raise the upload/parser limits together through the
  documented service env; Dify product routes retain their explicit 15 MiB contract.
- Kept provider partition strategy, image extraction, artifact content, and parser output
  unchanged. Archive-backed Office formats retain their local image fallback, while legacy Office
  and mail formats retain provider image extraction so existing image fidelity does not regress.

## Why

The previous isolated policy recognized only PDF. Large Office containers, spreadsheets,
presentations, mail, ODT/RTF, and EPUB could consume ordinary parser capacity and time out under a
two-minute budget even when their size or container structure clearly predicted expensive work.
At the same time, extending every Office request to 40 minutes would hide failures and reduce
throughput. The new classifier separates ordinary and heavy work without changing document
semantics. Aligning the parser input default with the product's 15 MiB upload default also closes a
deterministic 10–15 MiB admission gap.

## Verification

- TDD red/green regression for all 12 remote format families, compact and byte-heavy inputs,
  compact structurally-heavy and highly-compressible OOXML, hazardous/truncated archive metadata,
  forged EOCD comments, legal SFX prefixes, tolerant trailing bytes, MIME normalization,
  conflicting filename/MIME/magic signals, opaque legacy containers, mixed standard/heavy
  concurrency, queued cancellation, workload-specific leases/deadlines, legacy env aliases, and
  fingerprint stability.
- `pnpm --dir knowledge-fs --filter @knowledge/parsers test:coverage` — 150 tests passed; 96.36%
  statements/lines, 90.17% branches, and 97.66% functions.
- `pnpm --dir knowledge-fs --filter @knowledge/parsers typecheck` — passed.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app test` — 286 tests passed, including the
  ordinary-versus-heavy parser admission and timeout wiring regressions.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app typecheck` — passed.
- `pnpm --dir knowledge-fs --filter @knowledge/parsers build` and
  `pnpm --dir knowledge-fs --filter @knowledge/api-app build` — passed.
- `node --test knowledge-fs/scripts/compose-apps.test.mjs` — 14 tests passed after integrating the
  concurrent direct-upload and visual-embedding env contracts.
- `pnpm --dir knowledge-fs --filter @knowledge/api exec vitest run src/upload-session.test.ts` — 29
  tests passed, including exact-threshold single upload and fallback-bound equality.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app exec vitest run
  src/upload-session-options.test.ts` — 9 tests passed.
- `pnpm --dir knowledge-fs compose:config` and `pnpm --dir knowledge-fs dify:compose:config` —
  passed.
- Targeted Biome checks for every parser, parser-options, and Compose-test file changed by this
  slice passed. The final workspace-wide `pnpm --dir knowledge-fs lint:backend` regression also
  passed.

## Risks and follow-up

- The central-directory classifier is an admission heuristic, not a semantic parser. Malformed but
  not provably hazardous ZIPs may still reach the isolated heavy provider for compatibility; they
  never use the ordinary lane. Explicit expansion hazards are rejected before provider work.
- The heavy gate is process-local. Multi-replica deployments still need a shared admission layer
  if the backing Unstructured service has a cluster-wide resource ceiling.
- Provider image requests for legacy Office/mail cannot currently distinguish thumbnail-only
  capability from a true visual-asset requirement because the worker exposes one
  `requiresImages` hint. Turning those requests off would lose user-visible images. A later worker
  change should introduce separate visual-fidelity and thumbnail-capability signals before
  changing this behavior.
- No throughput improvement percentage is claimed. This change was verified for boundedness,
  routing, and concurrency behavior; representative cross-format staging benchmarks are still
  required for measured latency and throughput deltas.
- Safe resumable sharding remains format-specific follow-up work: CSV/JSONL may shard by records,
  XLSX by sheet/row bands, EPUB by spine item, and PDF by page range. DOCX/PPTX/legacy Office/mail
  must not be split as raw bytes or XML fragments because relationships, styles, notes, merged
  structures, and attachments can cross boundaries.
