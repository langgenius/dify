# Cross-format document materialization admission

## What changed

- Replaced the PDF-only worker admission boundary with a process-wide document materialization
  gate that applies to every supported format. The bounded phase starts before the eager source
  object read and ends after parsing, PDF rasterization/provider fallback, archive or remote-media
  extraction, image variant writes, raw parse checkpoint persistence, and canonical artifact
  materialization.
- Kept downstream outline, model, semantic, and projection work outside this gate so slow LLM calls
  do not retain a source-materialization slot.
- Made the shared concurrency gate cancellation-aware. A cancelled queued attempt is removed from
  the FIFO queue and its materialization function is never started; acquired slots are released on
  success, failure, or cancellation.
- Added `KNOWLEDGE_DOCUMENT_MATERIALIZATION_MAX_CONCURRENCY` (`1..8`, default `2`) to standalone,
  Dify Compose, Kubernetes, and production-image configuration. When the new setting is absent,
  the existing PDF concurrency value remains the compatibility fallback.
- Retained the old worker-level multimodal gate and max-concurrency options as deprecated aliases
  for direct callers while production wiring now uses the format-neutral names.
- Added a shared heavy-materialization pre-admission lane aligned with the parser workload policy.
  Metadata-known PDF/legacy work queues before the source read. Compact ZIP/OOXML inputs are read
  once under the global gate for bounded structural classification; only those classified heavy
  release that slot, discard the body, and reacquire in heavy-then-global order. This prevents a
  second long document from occupying every global slot while waiting for the parser heavy lane.
- Propagated the configured Unstructured heavy-lane width into runtime assembly, capped its outer
  pre-admission width at `materialization concurrency - 1` to reserve ordinary progress, and reject
  a heavy parser width greater than the global Unstructured request width.

## Why

The durable runtime can execute ten compilation attempts concurrently, while the previous full
materialization gate covered only image-enabled PDFs. DOCX, PPTX, XLSX, ODT, EPUB, email, and native
artifacts could therefore hold source bytes, Unstructured response objects, archive fallback data,
thumbnails, and checkpoint payloads concurrently. That multiplied peak resident memory and made a
mixed-format batch capable of exhausting an API replica. This change bounds the memory-heavy phase
without changing parser selection, document semantics, or publication behavior.

## Verification

- TDD regression first reproduced three simultaneous DOCX/XLSX/PDF parses through the former
  PDF-only boundary (`expected 2, received 3`).
- `pnpm --filter @knowledge/api exec vitest run src/bounded-concurrency.test.ts src/document-compilation-worker.test.ts`
  (`37` tests passed).
- `pnpm --filter @knowledge/api-app exec vitest run src/multimodal-options.test.ts`
  (`8` tests passed).
- `pnpm --filter @knowledge/api test` (`4,740` passed, `3` skipped).
- `pnpm --filter @knowledge/api-app test` (`278` tests passed).
- `pnpm --filter @knowledge/api typecheck` and
  `pnpm --filter @knowledge/api-app typecheck` (passed).
- `node --test scripts/compose-apps.test.mjs scripts/api-image-bundle-smoke.test.mjs`
  (`17` tests passed).
- `pnpm compose:config`, `pnpm dify:compose:config`, and `pnpm security:secrets` (passed).
- An intermediate combined-worktree coverage run measured `89.31%` aggregate branch coverage
  (clean HEAD was `89.27%`), while the new bounded-concurrency implementation itself measured above
  90% branch coverage. The final non-coverage API regression passed all `4,778` tests (`3` skipped).
- Focused tests cover a real compact 33-sheet XLSX workload classification, concurrent ordinary
  DOCX progress, metadata-known PDF single-read admission, cancellation before heavy reread,
  release after failure, parser/runtime concurrency invariants, and the direct-worker default of
  two for ordinary small text documents.

## Risks and follow-up

- The default intentionally trades some parallel parse throughput for a bounded memory envelope.
  Operators should tune the limit from observed replica RSS and queue-wait metrics, not document
  page count alone.
- This is an admission-control fix, not streaming parsing: one admitted attempt can still eagerly
  buffer its bounded source and provider response. Format-aware preflight and resumable structural
  shards remain separate follow-up work.
- Workloads that can only be proven heavy from archive structure incur one extra object-store read:
  preflight bytes are deliberately released before the narrow heavy queue so queued archives do
  not retain their full source bodies. Metadata-known PDF and opaque legacy formats retain the
  single-read path.
- The gate is process-local. Total deployment concurrency is this value multiplied by the number of
  API replicas, so replica scaling must be included in capacity planning.
