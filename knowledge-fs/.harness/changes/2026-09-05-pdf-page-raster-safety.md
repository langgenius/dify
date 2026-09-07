# Bound PDF page rasters before parser allocation

## Problem and evidence

A user-provided 247,902-byte, single-page PDF has a 2267.72 × 5102.36 point
MediaBox/CropBox (80 × 180 cm). File-byte and document-concurrency admission did
not bound its bitmap allocation. The pinned Unstructured image contains
unstructured 0.22.18 and unstructured-inference 1.6.11, defaults to 350 DPI, and
would render this page to 11024 × 24804 = 273,439,296 pixels. A single RGB buffer
alone is approximately 820 MB before image copies and inference allocations.
Its existing renderer ceiling was one billion pixels per page.

The pinned API does not expose `pdf_image_dpi` through its form/partition
whitelist, so sending a per-request DPI field cannot fix this issue.

## Changes

- The production Node parser injects a PDF preflight into the existing shared
  admission and single-flight operation, before transport starts. A single
  `pdfinfo` invocation checks all pages and their resolved size, MediaBox and
  CropBox. It admits at most 10,000 pages, 25 million pixels per page, and 10,000
  pixels per edge at 350 DPI. Unknown, incomplete or unsafe geometry fails closed.
- Inspection has a 10-second subprocess deadline, 4 MiB output limit, private
  temporary directory and 0600 source file. Cancellation kills and joins the
  child before cleanup. Non-PDF inputs do not incur filesystem/subprocess work.
- Dedicated parser defaults and local Compose retain 350 DPI and set
  `PDF_RENDER_MAX_PIXELS_PER_PAGE=25000000`. The pinned PDFium renderer enforces
  this before bitmap allocation across hi_res, OCR/auto fallback and image-block
  extraction. This also covers geometry differences between PDF engines.
- The pinned service exposes its raster guard as HTTP 500. An exact bounded
  JSON-detail classifier turns only that known rejection into a non-retryable
  provider input error before inline retries. Error inspection is limited to
  4 KiB/one second; other HTTP failures retain their retry semantics.
- Local Poppler crop generation now applies both edge and pixel budgets before
  rendering, including short-edge rounding. Coordinate mapping still uses the
  actual scaled page dimensions. Ordinary pages retain their original rendering
  parameters.
- Docker build/runtime checks verify `pdfinfo`; CI installs Poppler for actual
  PDF geometry integration tests. Deployment documentation covers both guards.

## Compatibility and operations

This is resource admission, not an output transformation. Original files, parser
strategies, text extraction and multimodal behavior of admitted files are
unchanged. Existing safe raw checkpoints remain reusable; budget-only checks do
not change parser output fingerprints. Platform-neutral callers constructing the
low-level parser client must inject an appropriate `requestPreflight`; the Node
API does so by default, and the dedicated service has its own allocation guard.

Oversized pages are rejected rather than silently converted to text-only parsing.
To import the sample banner, export it with smaller physical page dimensions or
tile its canvas into smaller pages. Splitting only between existing giant pages
or compressing the file further does not reduce this risk. Automatic layout-
preserving tiling/normalization is follow-up work, not implemented here.

Existing deployments need the new API image and a recreated dedicated parser with
the updated defaults. Operator env files load afterwards: remove any conflicting
DPI/pixel-limit overrides. Kubernetes users must apply the same limits to their
external Unstructured service. No database migration is required.

Geometry limits do not bound every embedded bitmap decoder, pathological PDF
object graph or model allocation. Container memory limits and workload admission
remain necessary. Poppler metadata inspection is bounded in duration/output, not
an OS-level memory sandbox.

## Verification

- TDD: unsafe input previously reached fetch; new tests fail before preflight
  integration and pass afterwards. Provider raster rejection previously retried
  as HTTP 500; the regression now observes exactly one request and no retry.
- Actual supplied PDF through `createApiDocumentParser`: rejected as
  `provider_input`, retryable=false, providerCalls=0, about 13 ms locally. No
  request was sent to an external parser. Bounded local rendering at 1 MP
  completed in about 314 ms and produced a 163,694-byte PNG.
- Preflight: 39 tests, including real Poppler inherited boxes and an oversized
  non-first page; lines/statements 99%, branches 94.89%, functions 100%.
- Parser package: 182 tests; lines/statements 96.23%, branches 90.30%, functions
  96.86%. Local rasterizer: 53 tests including scaled crop-coordinate fidelity.
- API full suite: 5,044 passed, 3 existing skips; API-app full suite: 349 passed.
  Local rasterizer focused coverage: lines/statements 94.86%, branches 92.61%,
  functions 98.61%. Workspace build/type checks (12 packages) and API production
  bundle passed. Backend lint (1,122 files), workflow/secret tests (28), Compose
  tests (14), image artifact tests (3), OpenAPI export tests (2), actual secret
  scan and local/Dify Compose configuration validation all passed.
- Full Docker image builds/live unsafe-file execution are intentionally not used
  for this diagnosis. No production configuration was changed. Read-only server
  inspection confirmed the two PDF limits are not configured yet; current
  OOMKilled=false with RestartCount=10 is not proof of the historical restart cause.
- The omnibus `pnpm check` (including Docker builds and live stack smoke tests)
  and whole-workspace frontend lint were not run for this backend-only change;
  the affected full package suites, coverage, backend lint, build and deployment
  artifact gates above were run instead. Dify backend logic and database schema
  are unchanged; only the KnowledgeFS subtree contract lock needs regeneration.

## Upstream evidence

- https://github.com/Unstructured-IO/unstructured/blob/0.22.18/unstructured/partition/utils/config.py
- https://github.com/Unstructured-IO/unstructured-inference/blob/v1.6.11/unstructured_inference/config.py
- https://github.com/Unstructured-IO/unstructured-inference/blob/v1.6.11/unstructured_inference/inference/pdf_image.py
