# DOCX image paragraph placement

## What changed

- Advanced the Unstructured parser policy to `unstructured@9` and added bounded WordprocessingML
  document and relationship inspection for DOCX-family archives.
- Matched Word paragraphs to canonical provider text only when repeated-text occurrence counts agree
  and the resulting placements are globally monotonic. Ambiguous or omitted occurrences fail closed.
- Projected each embedded image reference onto the preceding unambiguous paragraph's UTF-8 byte
  span.
- Preserved repeated references to the same media file as separate image items with their own Word
  paragraph index.
- Evaluated `mc:AlternateContent` choices against an explicit set of supported namespace URIs,
  selected the fallback for unknown requirements, and suppressed media referenced only by the
  unselected branch.
- Kept orphaned, malformed, external, wrong-type, or text-unmatched image references unpositioned
  instead of guessing a source location.
- Added a bounded `parseElementIds` field to the public chunk response. It is projected only from
  trusted server metadata, while the rest of `systemMetadata` remains private.
- Propagated the field through the Dify DTO and generated API contracts as the required
  `parse_element_ids` field. KnowledgeFS, the Dify DTO, and the frontend model now enforce the same
  contract without a legacy response shim.
- Changed the document reading view to suppress image-only retrieval chunks by exact parse element
  identity once their image is already rendered inline. No filename matching or user-metadata
  compatibility path is used.
- Kept those hidden image chunks in index metrics, while preserving the existing exclusion of
  structural-only and legacy-title chunks from the index count.

## Why

The archive fallback previously enumerated only `word/media/*`. It discarded the ordering and
relationships in `word/document.xml`, so every embedded DOCX image had `positionUnknown: true` and
the document page could render images only in the document-level fallback gallery.

## Safety boundaries

- Word XML and its relationship part are read during the existing bounded ZIP pass with the same
  per-file, file-count, and aggregate metadata limits used for spreadsheet anchors.
- Relationship targets must be internal, traversal-safe, image-typed, and use a supported image
  content type.
- Paragraph text occurrence counts must match the provider output, and candidate placements must
  remain in document order, before a span is trusted. Images after ambiguous or unmatched text remain
  unpositioned.
- Existing published revisions are immutable; upload or reindex with the new parser version is
  required to create corrected placement metadata.
- The duplicate-chunk display fix applies to already published revisions after a service/page
  refresh because the required element identities were already stored in server metadata.

## Verification

- Parser regression covers paragraph placement, duplicate media references, section inheritance,
  UTF-8 offsets, external relationships, wrong relationship types, and orphan media.
- `pnpm --filter @knowledge/parsers test:coverage` — 82 passed with 96.54% statements/lines,
  90.16% branches, and 98.84% functions, including distinct-media Choice/Fallback cases for
  supported, unsupported, mixed, and missing namespace requirements.
- `pnpm --filter @knowledge/parsers typecheck` — passed.
- A real upload of `关于大商务一体化平台技术管理系统各流程图说明.docx` produced an
  `unstructured@9` artifact with 10 positioned image references across 9 media files. All manifest
  items have non-null offsets, and the document page renders 10 inline figures with no fallback
  `Document images` section.
- `pnpm --filter @knowledge/api test` — 4,658 passed and 3 skipped.
- `pnpm --filter @knowledge/api test:coverage` executed the same passing suite, then reported the
  workspace-wide branch total at 89.27%, below the configured 90% global threshold.
- Dify KnowledgeFS facade and DTO tests — 157 passed; Ruff and Ruff format passed.
- Dify Swagger generation tests — 42 passed; OpenAPI Markdown and TypeScript/Zod contracts were
  regenerated with `parse_element_ids` required.
- Frontend document detail tests — 83 passed; Vite+ check passed.
- Generated API contracts and KnowledgeFS API TypeScript checks passed.
- Browser acceptance on the existing published document rendered 10 inline figures, zero
  `图像N` retrieval headings, and zero `Document images` fallback sections without reindexing. Index
  metadata remained accurate at 22 chunks and a 38-character average.
- Local runtime validation passed for Dify API, KnowledgeFS health/readiness, Community-development
  feature flags, Vinext, and the required Celery queues. Confirmed stale orphan workers from earlier
  hot reloads were terminated; the watcher-owned generic and upgrade workers now reply once each.
