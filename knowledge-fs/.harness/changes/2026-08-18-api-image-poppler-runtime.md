# Hybrid PDF Image Materialization

## Summary

- Kept Unstructured as the layout parser, including image/table coordinates and OCR text, while
  making Poppler the primary byte-materialization path for PDF figures and tables.
- Added a provider fallback that requests both `Image` and `Table` payloads when local PDF
  rasterization is unavailable or cannot completely resolve the document.
- Bumped the Unstructured parser policy to `unstructured@5`; its artifact hash now includes the
  normalized filename/MIME, parser hints, and the effective provider request policy so a parser
  strategy change cannot silently reuse an incompatible artifact.
- Installed `poppler-utils` in the API image, enabled it by default with an `off` kill switch, and
  aligned local Compose, Dify Compose, and Kubernetes configuration.
- Made parse-artifact materialization atomic and idempotent. The repository reports
  `created`/`replaced`/`unchanged`, preserves canonical object references on identical replays, and
  reconciles commit-acknowledgement ambiguity before cleanup.
- Added execution-owner object namespaces and a final multimodal materialization digest. Runtime
  object keys are excluded from that digest, while image/variant bytes, crop metadata, dimensions,
  renderer contract, and DPI remain part of publication identity.

## Runtime Bounds And Failure Recovery

- Poppler renders each distinct `(page, DPI)` once and reuses the decoded page for all crops.
  Main and thumbnail output therefore require two Poppler calls per page at the default distinct
  DPIs, rather than two calls per image/table element.
- PDF materialization uses an independent process-wide admission gate (default `2`, configurable
  `1..8`) around source loading, rendering, object writes, and canonical materialization. A caller
  abort waits for any uncancellable Sharp/storage/commit operation to settle before cleanup.
- Rasterization is bounded by a ten-minute document deadline, 30-second Poppler child timeout,
  4096-pixel page edge, 20-million decoded page pixels, 32 MiB encoded page/image caps, 64 MiB
  per-page crop output, 128 MiB per-document output, and 500 candidate elements.
- Relative, PDF-point, and Unstructured `PixelSpace` coordinates are scaled against actual rendered
  page dimensions. Fractional crops use `ceil(x + width)`/`ceil(y + height)` to avoid truncation.
- Partial local results are never published as complete: an unresolved figure/table triggers
  compensation and provider fallback for the whole unresolved set.
- Object cleanup is execution-owner scoped, pre-registers writes before PUT, runs with concurrency
  `4` and a 60-second scheduling budget, and preserves retryability when storage or cleanup is
  incomplete. This prevents transient cleanup failures from becoming terminal compilation errors.
- Object-storage HTTP calls have a 60-second per-request deadline and classify transient transport,
  408/409/425/429, and 5xx failures as retryable.
- Thumbnail generation rejects compressed-image expansion beyond 20 million pixels and encoded
  variants larger than 8 MiB.

## Parser Resource Controls

- Unstructured calls use an abort-aware FIFO gate (default `2`), a 120-second request/body deadline,
  a streamed 32 MiB response cap, and bounded retry delay. Oversized chunked responses are canceled
  before additional chunks are buffered.
- 408/409/425/429/5xx, transport, and timeout failures are retryable; invalid input, invalid schema,
  oversized response, and ordinary 4xx failures remain terminal.
- `image_base64` is removed before cloning provider metadata, avoiding an extra in-memory copy of
  large inline image payloads.
- Parser-specific failure codes are retained by the durable compilation runtime.

## Deployment And Precedence

- The final API image installs `poppler-utils` and executes a build-time `pdftoppm -v` check before
  switching to the non-root `node` user. The runtime bundle smoke repeats that check as `node`.
- Dify Compose uses six whitelisted `DIFY_ROOT_*_OVERRIDE` proxies. Precedence is explicit root
  `docker/.env` value, then service `knowledge-fs.env`, then image/code default; no unrelated root
  secrets are injected into the KnowledgeFS container.
- `KNOWLEDGE_PDF_RASTERIZER=off` remains the emergency kill switch. If Poppler is disabled or its
  result is incomplete, provider payload fallback remains available.
- Existing PDFs published without durable `assetRef.objectKey` values must be re-indexed after
  rollout; a missing object reference cannot be repaired by refreshing the viewer URL.

## Regression Coverage

- `@knowledge/api`: 411 test files passed, 4536 tests passed, 3 skipped; typecheck passed.
- `@knowledge/parsers`: 50 tests passed; 95.82% statements/lines, 90.10% branches, 97.45%
  functions; typecheck passed.
- `@knowledge/adapters`: 7 test files and 108 tests passed; typecheck passed.
- `@knowledge/api-app`: 45 test files and 257 tests passed; typecheck passed.
- API image and Compose/Kubernetes deployment checks: 15 tests passed.
- Full KnowledgeFS backend Biome gate checked 1061 files with no errors.
- `git diff --check` passed.

## Measured/Deterministic Performance Result

- Same-page `N` image/table crops now issue exactly two Poppler page renders at the default distinct
  main/thumbnail DPIs instead of `2N`; two pages issue four. This is asserted with real Poppler
  subprocess tests.
- The supplied invoice PDF was materialized locally into a 119,090-byte main image and a
  24,599-byte thumbnail at 144/48 DPI, proving the configured executable and crop pipeline work on
  the reported input.
- No end-to-end percentage improvement is claimed: deployment-level queue time, parser latency,
  object-storage latency, and container CPU/RSS have not been measured on a before/after workload.

## Local Limitation

- A full Docker image build/runtime smoke was not run locally because the Docker daemon is
  unavailable at the configured socket. The Dockerfile build itself now fails if `pdftoppm` is
  absent, and CI's image build plus runtime smoke exercise that gate.
- Execution-owned object cleanup is bounded and retryable, but a hard process exit after object
  storage commits and before in-memory ownership is durably recorded can leave an unreachable
  owner prefix. A durable owner-receipt GC is a separate storage-lifecycle follow-up; shared
  deterministic keys are intentionally avoided because overlapping at-least-once workers could
  delete a newer successful writer's object.
