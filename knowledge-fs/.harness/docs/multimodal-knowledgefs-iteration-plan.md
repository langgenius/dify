# Multimodal KnowledgeFS Iteration Plan

## Objective

KnowledgeFS should evolve from text-first document RAG with table/image metadata into a production-shaped multimodal knowledge system. The system should preserve the current fast/deep/research retrieval modes while making document tables, figures, OCR text, captions, page locations, bounding boxes, and future visual embeddings first-class, inspectable resources.

## Current State

The system already has weak multimodal support:

- `ParseElement` supports `table`, `image`, `code`, and `page-break`.
- `KnowledgeNode.kind` supports `table` and `image`.
- `ArtifactSegment.segmentType` supports `table`, `image`, `binary`, and page-like segments.
- KnowledgeFS can render table nodes as JSON/HTML and image nodes as Markdown with caption/OCR metadata.
- Retrieval has `createTableSpecificRetrievalPath` and `createImageOcrRetrievalPath`.
- Document outlines can localize evidence by section, page, and offset.

The current system is not yet native multimodal:

- Embedded image bytes, explicitly allowlisted local image files, and optional PDF rasterized page/image candidates can now be extracted into object storage with thumbnail variants. PDF rasterization now supports explicit `pixel`, `pdf-point`, and `relative` bbox geometry normalization. Non-PDF image dimensions are inferred from common image headers, and a Sharp-backed thumbnail adapter is wired through app configuration.
- There is now a visual embedding projection builder/provider contract for CLIP-like vectors, a deployable text-surrogate visual embedding adapter, an object-storage image-byte adapter that loads object-backed image assets before embedding, and apps/api HTTP image-byte visual embedding wiring for hosted or self-hosted CLIP/VLM services.
- There is now an optional enrichment provider interface for captions/OCR/table/chart/visual embedding metadata, plus provider composition, metadata normalization, a generic chart/table/image understanding adapter, and apps/api OpenAI-compatible multimodal enrichment wiring that persists provider/model/prompt/status metadata.
- The answer generator can use text fallback prompts or native VLM-style image content blocks through injectable providers; apps/api can now wire OpenAI-compatible multimodal answering with object-storage backed data URL image blocks.
- Table understanding is text/metadata driven rather than table-structure aware across all paths.
- A document-level multimodal manifest now summarizes available figures/tables/code/page markers, missing enrichment state, provider budget usage, skipped item counts, and failed provider states.

## Target Behavior

Each parsed document should expose a `DocumentMultimodalManifest`:

```text
DocumentMultimodalManifest
  id
  knowledgeSpaceId
  documentAssetId
  parseArtifactId
  artifactHash
  version
  manifestVersion
  items[]
  metadata
  createdAt
  updatedAt?

DocumentMultimodalItem
  id
  modality: table | image | code | page
  parseElementId
  title?
  caption?
  textPreview?
  ocrText?
  pageNumber?
  sectionPath[]
  startOffset?
  endOffset?
  boundingBox?
  assetRef?
  enrichment
  sourceMetadata
```

The manifest is a document-level inventory, not a replacement for leaf nodes. Raw table/image/code nodes continue to be indexed for dense, full-text, graph, and research retrieval.

## Retrieval Modes

- Fast: keep dense + full-text over textualized evidence.
- Deep: include table/image OCR paths and expose multimodal candidate metrics.
- Research: inspect document outline and multimodal manifest before opening relevant page/section/resource ranges. Done for dry-run planning through an explicit `inspect` step that accounts for outline and multimodal inventory tool calls.

## Iteration Slices

1. Add `DocumentMultimodalManifest` schemas and a deterministic builder from `ParseArtifact.elements`. Done.
2. Expose manifest through HTTP and KnowledgeFS. Done:
   - `GET /knowledge-spaces/{id}/documents/{documentId}/multimodal`
   - `/knowledge/docs/{document}/multimodal.json`
3. Standardize table/image/code metadata so future VLM/CLIP enrichment has stable fields. Done through manifest `assetRef`, `boundingBox`, `caption`, `ocrText`, `textPreview`, `sourceMetadata`, per-capability `enrichment` statuses, PDF raster `cropKind`, and rasterized table assets as visual embedding candidates.
   Markdown and HTML native parsers now normalize image references into `image` parse elements with `assetRef.uri`, caption/title metadata, and inferred image content type.
4. Add retrieval metrics and traces that identify table/image/OCR candidate counts and selected multimodal items. Done for the current contract; existing table/image retrieval paths expose `tableCandidates` and `imageCandidates`, image/OCR retrieval now annotates selected items with `multimodalCandidate` metadata (`documentAssetId`, version, page, sectionPath, parseElementId when available), and hybrid query done-event citations resolve that candidate to manifest item id, KnowledgeFS asset descriptor path, binary asset route, page/section/offset, and bounding-box fields when the parse artifact is available.
   Research dry-run plans now expose a separate `inspect` phase before retrieval for outline + multimodal manifest inspection.
5. Add optional enrichment provider interfaces:
   - image caption/VQA/OCR provider
   - table structure summarizer
   - chart understanding provider
   Done for provider contracts through `DocumentMultimodalManifestEnhancer`, a built-in metadata provider, provider composition, and an understanding adapter for image/chart/table providers.
6. Add visual asset extraction/storage:
   - stable object keys for extracted figures/crops
   - thumbnail/full-resolution variants
   - bounding boxes and page references
   Done for the read contract: `assetRef.objectKey` can now be resolved through `GET /knowledge-spaces/{id}/documents/{documentId}/multimodal/{itemId}/asset`, with tenant/space object-key scoping, Admin client support, and KnowledgeFS descriptor paths under `/knowledge/docs/{document}/assets/*.json`. Parser-side external image reference normalization is done for Markdown/HTML, embedded `data:image/...;base64,...` assets are extracted into object storage during sync/async ingestion, and an optional PDF rasterizer can materialize page-break full-page previews plus image/table bbox crops into object-backed PNG assets with thumbnail variants. Non-PDF extracted image assets can now generate thumbnail variants through a Sharp-backed image variant generator. Richer coordinate-unit normalization is done for common parser aliases.
7. Add multimodal embeddings:
   - projection type or metadata for visual vectors
   - model/version metadata
   - late fusion with text retrieval
8. Add answer generation support for visual evidence:
   - include image refs or base64/file handles for capable models
   - fall back to caption/OCR evidence for text-only models
9. Add Admin multimodal browser:
   - document-level manifest summary
   - tables/figures grouped by section/page
   - enrichment status and missing asset warnings
   Done for a first browser pass on the document status page, showing modality counts, detected items, section/page, preview text, and enrichment status.
10. Add evals:
   - chart/table QA
   - figure localization
   - OCR recall
   - citation page/bounding-box hit rate

## Completed Implementation Scope

This iteration has implemented slices 1, 2, 5 interface wiring, 6 read contract, 9 first browser pass, and part of 4:

- Core schema for `DocumentMultimodalManifest`.
- API builder that derives a manifest from parse artifacts.
- HTTP read route.
- KnowledgeFS `multimodal.json` path for uploaded/compiled documents.
- Tenant-scoped HTTP asset read route for manifest items with `assetRef.objectKey`.
- KnowledgeFS asset descriptor paths for manifest items with `assetRef`, returning JSON metadata and a relative binary asset URL.
- Native Markdown/HTML parser normalization for image references into multimodal-ready parse elements.
- Unstructured parser visual metadata normalization for image/table/page-layout elements, including textless image retention, `assetRef.uri`, `boundingBox`, `ocrText`, and table HTML metadata.
- Bounded embedded data URI image extraction into tenant-scoped document asset object storage, with parse artifact `assetRef` rewritten to `objectKey`/`sha256`.
- Research dry-run planning now includes an explicit multimodal/outline inspection step before retrieval.
- Image/OCR retrieval path now annotates selected visual evidence with multimodal candidate metadata.
- Hybrid query generation resolves multimodal candidate metadata into manifest item id, KnowledgeFS asset descriptor path, binary asset route, and page/section/offset/bounding-box citation fields before writing citations into answer traces.
- Optional manifest enrichment provider interface with deterministic merge behavior and KnowledgeFS/API read integration.
- Cached enriched manifest repository/wrapper so repeated reads reuse provider-enriched manifests while artifact hash, manifest id, parse artifact id, and manifest version remain fresh.
- Built-in metadata multimodal enrichment provider and composite provider adapter so parser OCR/caption/table/chart metadata can be normalized now and real OCR/VQA/table/chart providers can be chained later.
- Hybrid answer generation now exposes resolved multimodal evidence as structured trace metadata and text fallback lines with modality, page/section, descriptor path, and binary asset route.
- Hybrid answer generation now has an optional multimodal answer provider contract that receives resolved visual/table attachments plus textual evidence, so VLM/file-ref answer generation can be plugged in without changing retrieval.
- A text LLM multimodal answer adapter now turns resolved asset routes, page/section/bounding-box metadata, OCR/caption text, and retrieval evidence into grounded answer prompts. A native content-block multimodal answer adapter can pass resolved image/page attachments as image blocks to VLM-capable providers while preserving text fallback metadata.
- Dense and FTS projection metadata now carries multimodal linkage for image/table/code/page textual surrogates, including modality, parse element id, page/section, asset ref, bounding box, and visual embedding status.
- TypeScript chunking preserves whitelisted single-element visual/table metadata (`assetRef`, `boundingBox`, `caption`, `ocrText`, table HTML/structure, and title) on emitted image/table nodes so downstream projection and citation stages can resolve real assets.
- Sync and async ingestion can extract bounded embedded data URI images and explicitly allowlisted local image file references into tenant-scoped object storage, rewriting parse element `assetRef` metadata with object key, content type, SHA-256, and source provenance.
- Multimodal asset extraction now enforces per-document extracted asset count limits in addition to embedded/local image byte limits.
- A visual embedding projection builder/provider contract can now create independent `visual-asset` dense-vector projections from image/table nodes with object-backed `assetRef` metadata while preserving node, parse artifact, page, section, and bounding-box linkage. The incremental reindexer can optionally run that builder alongside FTS/dense text projections when `visualBuilder` and `visualModel` are configured.
- Object-backed image-byte visual embedding is supported through `createObjectStorageVisualEmbeddingProvider`, which reads `assetRef.objectKey` or a preferred variant such as `thumbnail` from object storage, enforces asset byte limits, and forwards image bytes to an injectable image embedding provider.
- The API app can configure OpenAI/Voyage/Cohere/static embedding providers through `KNOWLEDGE_EMBEDDING_PROVIDER`; the configured provider enables query embeddings, dense retrieval, dense ingestion projections, and text-surrogate visual projections.
- Visual-query retrieval now reads projection-level `metadata.multimodal`, preserves asset/bounding-box/modality in multimodal candidates, and reports `multimodalCandidates`, `imageCandidates`, and `visualEmbeddingCandidates` metrics when relevant.
- Multimodal citation evaluation utility scores manifest item, page, bounding-box localization, and visual embedding status hit rates for regression/eval gates.
- Multimodal understanding evaluation utility scores chart/table/image manifest enrichment against expected modality, title, provider status, and summary keyword coverage.
- Multimodal OCR recall evaluation utility scores expected OCR keywords against manifest image/table OCR text and text previews.
- Generic chart/table/image understanding enrichment adapter can call an injectable provider, pass source table text, truncate summaries, persist provider/model/prompt/status metadata, surface generated captions/OCR/table status, and recover provider failures into manifest metadata.
- Manifest enhancement metadata now reports provider budget usage (`maxItems`, `maxSourceTextChars`), attempted/enhanced/skipped item counts, and failed provider result counts so expensive multimodal enrichment calls are observable.
- Admin document page multimodal browser and API client support, including asset availability state, binary asset fetch support, and server-rendered image previews for object-backed image items.
- KnowledgeFS now exposes multimodal item descriptor paths grouped by resource type: `/figures/*.json`, `/tables/*.json`, and `/pages/{page}/thumbnail.json`, in addition to `/assets/*.json` and `/multimodal.json`.
- Multimodal binary asset reads support named variants such as `?variant=thumbnail`, and KnowledgeFS descriptors expose `thumbnailAssetUrl` when a thumbnail variant exists.
- Extracted non-PDF image assets record header-derived `width`/`height` metadata for PNG/JPEG/GIF/WebP when available and can generate thumbnail variants through the app-configured Sharp image variant adapter.
- Optional PDF rasterization pipeline for sync and async ingestion: PDF page/image candidates are rendered through a `DocumentPdfRasterizer`, stored under stable tenant-scoped object keys, and rewritten into `assetRef.objectKey` metadata before manifest building, asset extraction, reindexing, and Admin preview. A Poppler `pdftoppm` adapter and apps/api environment switches (`KNOWLEDGE_PDF_RASTERIZER`, command, DPI, timeout, max assets) are available.
- PDF rasterized outputs can carry `assetRef.variants` such as `thumbnail`; the variant contract is preserved by core schemas, manifest building, KnowledgeFS asset descriptors, Admin API parsing, and object storage. Poppler can automatically render a lower-DPI thumbnail variant via `KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI` and `KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT`.
- Retrieval metrics fields for table/image multimodal candidates already produced by existing paths.
- Unit/integration tests for schemas, manifest building, enrichment, HTTP read, KnowledgeFS reads, Admin API parsing, Admin page rendering, and retrieval metrics.

## Next Implementation Scope

The remaining implementation should be executed in this order. Each item should land with tests and be kept independently useful.

### Detailed Completion Plan

The remaining work is tracked as implementation slices with explicit acceptance checks. Each slice should be committed and pushed before the next slice begins.

1. **Visual Variant Generation**: Done for PDF rasterized candidates, non-PDF extracted image thumbnails, and contract propagation.
   - Add automatic PDF raster thumbnail generation without introducing a required native image dependency.
   - Preserve `assetRef.variants.thumbnail` through core schemas, manifest building, KnowledgeFS descriptors, retrieval metadata, and Admin parsing.
   - Add config for thumbnail DPI/variant name and tests for variant object storage.
   - Done when PDF page/image raster candidates can produce a full PNG plus a thumbnail PNG variant with stable object keys and content hashes.
2. **PDF Geometry Normalization**: Done for explicit pixel/pdf-point/relative bbox metadata, Poppler crop normalization, parser-specific bbox aliases, coordinate-unit aliases, and common page dimension containers.
   - Add explicit bbox coordinate metadata (`coordinateSystem`, `sourceDpi`, `renderDpi`, `pageWidth`, `pageHeight`) to raster output.
   - Normalize Unstructured/PageIndex-style coordinates into Poppler crop coordinates at render time.
   - Add tests for pixel and normalized coordinate inputs.
   - Done when bbox crops are deterministic across parser coordinate systems and surfaced in citations/manifest metadata.
3. **Native VLM Answer Provider**: Done at core adapter level and apps/api wiring level through injectable image content-block generation plus object-storage backed data URL image blocks for OpenAI-compatible providers.
   - Add a provider adapter that can send resolved object-backed images as image URL/base64/content blocks to VLM-capable generation providers.
   - Keep the current text fallback adapter for non-vision models.
   - Add prompt/attachment budget limits and trace metadata for selected image blocks.
   - Done when hybrid answer generation can produce answers using actual image inputs, not only OCR/caption text.
4. **Image-Byte Visual Embeddings**: Done at object-storage adapter level plus apps/api HTTP image-byte provider wiring for hosted or self-hosted CLIP/VLM services.
   - Add a `VisualEmbeddingProvider` adapter that consumes object-backed image bytes or signed/read URLs instead of text surrogates.
   - Support model metadata, vector dimension, provider errors, and fallback to text-surrogate mode.
   - Add tests for image bytes flowing from object storage to projection creation.
   - Done when visual-asset projections can be built from true image content.
5. **Chart/Table Understanding Providers**: Done at adapter/contract level and apps/api OpenAI-compatible provider wiring level; additional hosted provider families remain deployment-specific follow-up.
   - Add concrete provider adapters for chart summaries, table structure summaries, and table QA-ready summaries.
   - Persist model/version/status metadata in enriched manifests.
   - Done when chart/table manifest items expose generated summaries with failed/stale/provider status.
6. **Multimodal Eval Expansion**: Partially done.
   - Add OCR recall, chart QA, table QA, and visual citation localization fixtures.
   - Gate regressions with per-mode metrics for fast/deep/research.
   - Done now for citation localization, visual embedding status hit metrics, manifest understanding keyword/title/status metrics, OCR keyword recall, and per-mode fast/deep/research metric gates. Remaining follow-up: external QA fixture datasets.
7. **Safety, Quotas, And Failure States**: Partially done for document-level extraction limits, scoped object access, and observable provider budgets/failures.
   - Add per-document visual asset byte budgets, provider cost budgets, and enrichment failure state surfacing.
   - Keep tenant/object-key access scoped and avoid remote URL proxying without an allowlist.
   - Done now for max extracted asset count, object-key scoping, enrichment attempted/skipped/failed counters, and provider budget metadata. Remaining follow-up: provider token/cost accounting backed by tenant budget policy.

### P0: Complete The Core Multimodal Contract

1. Resolve live retrieval `multimodalCandidate.parseElementId` to: Done through `DocumentMultimodalCandidateResolver` and hybrid query citation enrichment.
   - `manifestItemId`
   - KnowledgeFS asset descriptor path
   - binary asset route when `assetRef.objectKey` exists
   - page/section/offset/bounding-box citation fields
2. Persist or cache enriched multimodal manifests: Done for in-process caching through `DocumentMultimodalManifestRepository`, `createCachedDocumentMultimodalManifestEnhancer`, and database-backed persistence through `createDatabaseDocumentMultimodalManifestRepository` wired into apps/api database repository mode. Richer failed/stale state surfacing remains a production hardening follow-up.
   - avoid recomputing expensive OCR/caption/chart providers on every read
   - include provider model/version/promptVersion metadata
   - expose stale/missing/failed enrichment states
3. Add concrete provider adapters behind `DocumentMultimodalManifestEnhancer`: Done for built-in metadata normalization, provider composition, a generic understanding adapter for OCR/VQA/table/chart model clients, and apps/api OpenAI-compatible object-backed enrichment wiring; additional hosted model families remain deployment-specific follow-ups.
   - OCR provider
   - image caption/VQA provider
   - table structure summarizer
   - chart understanding provider
4. Make answer generation multimodal-aware: Done for retrieval-grounded fallback answers, trace metadata through `multimodalEvidence`, an optional multimodal answer provider contract, a text LLM adapter over resolved asset refs/page/bounding-box/OCR evidence, an injectable content-block VLM adapter, and apps/api OpenAI-compatible wiring that loads object-backed images as data URL blocks.
   - pass image/file refs to capable VLM providers: Done at content-block adapter level.
   - fall back to OCR/caption/table summaries for text-only providers
   - preserve citations with page/section/bounding box/asset refs

### P1: Produce Real Visual Assets

5. Extract PDF/page-layout visual crops: Done for embedded data URI assets, explicitly allowlisted local image files, external parser-provided image paths/URLs, optional local Poppler rasterization of PDF image/page/table candidates into PNG object assets with thumbnail variants, explicit pixel/pdf-point/relative bbox normalization, parser-specific page dimension inference, and chart/table-specific crop classification. Non-PDF image dimensions are inferred from common image headers and thumbnail variants are generated through the Sharp image variant adapter.
   - figures/images
   - charts
   - tables
   - page thumbnails
   - full-resolution variants
6. Generate and store thumbnail/full-resolution object variants: Done for PDF rasterized thumbnails and non-PDF extracted image thumbnails with stable object keys, content hashes, dimensions when inferable, source provenance, byte limits, and tenant/object-key scoping.
   - stable object keys
   - content hashes
   - dimensions
   - source page/bounding box
7. Add KnowledgeFS paths for visual variants: Done for descriptor paths.
   - `/knowledge/docs/{document}/assets/*.json`: Done.
   - `/knowledge/docs/{document}/pages/{page}/thumbnail.json`: Done as JSON descriptor with thumbnail asset metadata and thumbnail binary URL when present.
   - `/knowledge/docs/{document}/figures/*.json`: Done.
   - `/knowledge/docs/{document}/tables/*.json`: Done.

### P2: Visual Indexing And Fusion

8. Add visual embedding index metadata: Done for dense/FTS textual-surrogate projections through `metadata.multimodal`, and done for a visual embedding projection builder contract plus incremental reindexer integration that writes `visual-asset` dense-vector projections when a provider supplies visual vectors. A text-surrogate visual embedding provider is wired for deployable fallback, and an object-storage image-byte adapter can feed object-backed image bytes into true visual embedding providers.
   - model id/version
   - vector dimension
   - projection type
   - item id / asset object key linkage
9. Implement visual late-fusion retrieval: Done for OCR/caption textual-surrogate late fusion, projection-level multimodal metadata, query embedding configuration, visual-asset dense-vector retrieval metrics, and HTTP visual text-query embedding fallback/primary mode for querying true visual vector projections.
   - text dense/full-text
   - image OCR/caption
   - visual vector similarity
   - graph expansion
   - outline + manifest guided research expansion
10. Add retrieval/eval instrumentation:
   - selected manifest item ids
   - image/table/chart candidate counts
   - asset descriptor paths
   - visual embedding hit counts: Done for hybrid retrieval metrics through `visualEmbeddingCandidates`, citation eval visual embedding hit rate, and per-mode multimodal eval gates.
   - reasoning tree opened multimodal resources

### P3: Admin, Evals, And Safety

11. Admin multimodal viewer:
   - thumbnails: Done for PDF rasterized candidates and non-PDF extracted image assets through generated thumbnail variants, server-rendered previews, and explicit thumbnail asset links.
   - page grouping: Done on the document status page by grouping multimodal items by page and section.
   - enrichment status
   - provider error details: Done for manifest-level provider budget/failed/skipped counts and item-level provider status/error summaries from enrichment metadata.
   - direct asset preview/download: Done for object-backed image assets through original and thumbnail asset links on the document status page.
12. Add eval fixtures: Partially done for figure/page/bounding-box/visual-embedding citation localization metrics through `evaluateDocumentMultimodalCitations`, manifest understanding metrics through `evaluateDocumentMultimodalUnderstanding`, and OCR keyword recall through `evaluateDocumentMultimodalOcrRecall`; external chart/table QA datasets remain follow-up.
   - OCR recall
   - chart/table QA
   - figure localization
   - bounding-box citation hit rate
13. Add safety and quotas:
   - max extracted asset bytes per document
   - max assets per document: Done for extraction through `maxExtractedAssets`.
   - max provider calls/source text per document: Done through manifest enhancer `maxItems` and `maxSourceTextChars`, now surfaced as provider budget metadata.
   - max provider cost per document: Follow-up for provider token/currency budget accounting.
   - tenant-scoped asset access checks
   - no remote URL proxying without an explicit allowlist

## Acceptance Criteria

- Every parsed document can return a deterministic multimodal manifest, even if it contains no visual/table resources.
- Manifest items map back to parse element ids, section paths, page numbers, offsets, and source metadata.
- Existing table/image retrieval paths still work and expose explicit metrics.
- KnowledgeFS can list and `cat` `/knowledge/docs/{document}/multimodal.json`.
- The manifest enhancer leaves a clean extension point for future VLM, OCR, table understanding, and visual embedding providers.
