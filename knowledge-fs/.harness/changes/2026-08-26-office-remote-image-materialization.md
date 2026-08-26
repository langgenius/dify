# Office and remote document image materialization

## What changed

- Kept embedded OpenXML/ODF/EPUB images on the existing archive-media path and added a regression for legacy `.doc` image payload extraction.
- Added a Dify-authenticated, SSRF-protected remote-image bridge for parser-produced HTTP(S) image references.
- Materialized remote images from Markdown, HTML, Office, and other parser formats through the same bounded KnowledgeFS object-storage and thumbnail path as embedded images.
- Included the final image-byte digest in synchronous compilation lineage so a changed visual artifact cannot reuse a stale multimodal publication identity.
- Added deployment configuration for the bounded inner remote-image request timeout.

## Why

- Some parsers return linked document images as HTTP(S) references instead of embedded bytes. Those references previously remained in manifests without an `objectKey`, so the document page could not render them reliably.
- The behavior must be format-independent: DOCX/DOC/PPTX/XLSX images need the same stable storage contract as Markdown and HTML images.

## Safety boundaries

- Only PNG, JPEG, GIF, and WebP payloads up to 10 MiB are accepted after content sniffing.
- External requests use Dify's existing signed-file resolver and SSRF-protected network client; credentials in URLs and unsafe network targets are rejected.
- Missing, blocked, oversized, or unsupported linked images remain as source references and do not block embedded Office images or fail the entire document.
- Transient bridge failures remain retryable, while each KnowledgeFS-to-Dify request has a configurable 30-second default timeout.

## Verification

- `pnpm --dir knowledge-fs --filter @knowledge/parsers test:coverage` (63 passed; package coverage above 90% in every dimension)
- `pnpm --dir knowledge-fs --filter @knowledge/adapters test:coverage` (117 passed; package coverage above 90% in every dimension)
- `pnpm --dir knowledge-fs --filter @knowledge/api-app test` (262 passed)
- `pnpm --dir knowledge-fs --filter @knowledge/api test:coverage` (all tests passed; branch coverage 89.27%, identical to clean-HEAD baseline and below the repository's pre-existing 90% gate)
- Focused KnowledgeFS Python tests (31 passed; remote-image service line/branch coverage 98.8%/96.2%)
- KnowledgeFS TypeScript typechecks, Biome, Ruff, deployment compose tests, and contract-lock verification

## Risks and follow-up

- Linked images are fetched sequentially under the existing per-document extraction cap to keep memory bounded. Large documents with many slow external hosts may take longer than documents whose images are embedded.
- Existing revisions whose manifests have no `objectKey` are not mutated in place; reindexing or creating a new revision is required to materialize their missing linked images.
