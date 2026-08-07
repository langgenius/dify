# Image Query Retrieval

## What Changed

- Made text and Dify `UploadFile` images alternative query modalities: at least one is required and
  callers may intentionally provide both.
- Added tenant/account ownership, UUID, MIME, count, per-file size, aggregate size, content-sniff,
  and checksum validation without copying image bytes into KnowledgeFS storage.
- Added an authenticated Dify inner endpoint and a bounded KnowledgeFS resolver for query images.
- Added query-side multimodal embedding with `inputType: "query"`, one visual search per image,
  equal-weight result fusion, an explicit opt-in flag, and typed degradation when the visual lane is
  unavailable.
- Added one bounded Deep/Research image-to-text expansion. Pure-image Research requires it for
  document selection and level-by-level PageIndex navigation; Fast never invokes it.
- Persisted UploadFile references and the first successful Research expansion for deterministic
  retry/replay. Raw bytes are never persisted in jobs, evidence, sessions, or traces.
- Put the expansion model call into Research dry-run estimates and durable budget accounting.
- Gave query images precedence over evidence images in final Research VLM attachment budgets, with
  typed trace/terminal degradation when vision synthesis is unavailable.
- Extended EvidenceBundle and AnswerTrace metadata, public Research responses, OpenAPI contracts,
  deployment documentation, and the service-specific environment example.

## Why

KnowledgeFS could index and retrieve document images but could not use a user's image as the query.
The new path reuses Dify-owned uploads, model instances, plugin-managed credentials, and unified
storage while preserving immutable publication/permission fences and the book-like PageIndex
behavior of Research.

## Safety And Performance

- Maximum four images, 10 MiB each and 32 MiB total; PNG/JPEG/WebP/GIF only.
- No inline base64 at the browser-facing API and no persisted duplicate bytes.
- Fast has no new vision-LLM call. Deep/Research make at most one expansion call under an 8-second
  default timeout; durable retries reuse its persisted text.
- Every query image is searched independently; vectors are never averaged.
- Text-only request/response compatibility remains unchanged, including omission of empty
  `queryImages` fields from Dify product responses.
- Query images remain behind `KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED=false` by default for the
  visual lane; explicit visual query mode `off` wins.

## Verification

- `pnpm --dir knowledge-fs --filter @knowledge/api test:coverage`: 4,286 passed, 3 skipped;
  line coverage 93.88% and branch coverage 90.00%.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app test`: 223 passed.
- Focused Dify DTO, query-image service, console delegation, inner endpoint, and OpenAPI suites:
  223 passed.
- `pnpm --dir knowledge-fs typecheck`: 22 tasks passed.
- `pnpm --dir knowledge-fs lint:backend`: 1,016 files passed.
- `pnpm --dir knowledge-fs openapi:export:test`: 2 export determinism tests passed.
- `generate_knowledge_fs_contract.py --update-lock` regenerated the reviewed subtree/OpenAPI lock;
  the subsequent `--check` passed.

## Non-Goals

- No frontend image picker or Admin Console changes.
- No per-query recognition of retrieved document images.
- No Golden Question generation or ingest-side multimodal enrichment reindex work.
