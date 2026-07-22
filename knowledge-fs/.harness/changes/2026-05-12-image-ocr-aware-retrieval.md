# Image/OCR-Aware Retrieval

## What Changed

- Updated the Rust/WASM chunker so image parse elements with text emit `KnowledgeNode.kind = "image"`.
- Added `createImageOcrRetrievalPath()` for bounded visual/OCR-aware retrieval.
- Visual queries or explicit image filters trigger one additional `nodeKinds: ["image"]` retrieval leg.
- Image hits are merged and deduplicated with base retrieval, boosted, and annotated with `metadata.imageRetrieval`.
- Retrieval metrics now include `imageCandidates` when image/OCR retrieval runs.
- KnowledgeFS `cat` for image nodes now returns Markdown with:
  - Caption.
  - OCR text.
  - Source location.
  - Metadata JSON.

## Why

- Sprint 15 requires figure/image nodes to carry OCR text, captions, and source location so visual evidence can be retrieved and inspected like text/table evidence.
- Keeping image/OCR retrieval as a bounded wrapper avoids broadening normal retrieval paths and keeps database access patterns unchanged.

## Verification

- RED first:
  - `cargo test --workspace maps_image_elements_with_ocr_text_to_image_nodes` failed because image elements were emitted as generic chunks.
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts src/gateway.test.ts` failed because the image/OCR retrieval wrapper and figure `cat` formatting were missing.
  - `pnpm --filter @knowledge/api test:coverage` failed below 90% branch coverage before edge-case tests were added.
- Focused verification:
  - `cargo test --workspace maps_image_elements_with_ocr_text_to_image_nodes`
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Performance Notes

- Image/OCR retrieval adds at most one extra bounded retrieval call.
- Explicit non-image filters do not trigger image/OCR retrieval.
- Figure Markdown rendering uses the already-loaded node and does not query parse artifacts, object storage, or external OCR services.

## Known Risks And Follow-Up

- Visual query detection is keyword-based. Query planner signals can replace it later.
- Figure Markdown currently renders metadata JSON rather than rich page-region previews. A later UI/source preview slice can render image crops from source-location metadata.
