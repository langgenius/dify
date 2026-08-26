# Expanded document upload formats

## What changed

- Added upload admission, MIME validation, and octet-stream inference for the legacy-compatible
  `.markdown`, `.mdx`, `.vtt`, `.properties`, `.xml`, `.odt`, `.eml`, and `.msg` formats.
- Routed VTT and Java properties files through the bounded native text parser. Markdown aliases and
  XML continue to use the existing native Markdown and structured-data parsers; ODT, EML, and MSG
  use the existing Unstructured parser boundary.
- Kept the Dify New RAG file picker and local upload policy in sync with the KnowledgeFS service
  allowlist.
- Gave the Dify KnowledgeFS staging service the same explicit extension allowlist and a dedicated
  `knowledge_fs` upload source, so staging no longer inherits the legacy knowledge-base `ETL_TYPE`
  whitelist. Unsupported extensions are still rejected before storage writes.
- Canonicalized staged-upload MIME types from the admitted extension, and changed direct
  KnowledgeFS admission from two independent allowlists to an extension-to-MIME contract. Common
  aliases such as `text/rtf` and JSONL declared as `application/json` remain accepted, while
  unrelated pairs such as PDF plus `text/plain` are rejected.
- Prioritized complex binary extensions in parser routing so an inaccurate browser MIME declaration
  cannot send PDF, Office, EPUB, RTF, ODT, EML, or MSG content through the native text parser.
- Preserved visible text inside MDX JSX blocks instead of silently dropping Marked's block HTML
  tokens. MDX now carries its own `native-mdx@1` parser version so the behavior does not invalidate
  existing plain-Markdown artifact hashes.
- Updated upload guidance in every supported locale to describe the supported format groups without
  exposing deployment-specific parser details to end users.
- Added behavior tests for declared MIME types, octet-stream inference, native lightweight-text
  routing, and the browser file-picker contract. The new tests were observed failing before the
  implementation and passing afterward.
- Added deadline and reasonless-abort coverage for the bounded Unstructured request lifecycle after
  the CI branch-coverage gate exposed the remaining paths.

## Why

The new knowledge base rejected several formats already accepted by the legacy knowledge base even
though its parser stack could process them. Expanding the allowlists and using the lightest existing
parser restores compatibility without adding a new parser, storage path, or network dependency.

## Verification

- `pnpm --filter @knowledge/api exec vitest run src/document-upload-utils.test.ts` — passed (21 tests).
- `pnpm --filter @knowledge/parsers exec vitest run src/parser.test.ts` — passed (55 tests).
- `pnpm --filter @knowledge/parsers test:coverage` — passed with 95.99% statements/lines,
  90.10% branches, and 98.34% functions (62 tests).
- `pnpm --filter @knowledge/api-app exec vitest run src/parser-options.test.ts` — passed (5 tests).
- `vp test run --project unit features/new-rag/__tests__/documents-page.spec.tsx` — passed (203 tests).
- KnowledgeFS typechecks — passed; the full Turbo test pipeline passed (22 tasks), including the API
  suite with 4,640 tests passed and 3 skipped.
- Targeted KnowledgeFS Biome check for the five changed TypeScript files — passed.
- Targeted Dify `vp check` for the two changed Web files — passed.
- All 24 localized `dataset.json` files parsed successfully and contain the updated upload-format
  guidance. The repository-wide dataset i18n alignment check remains blocked by pre-existing
  missing KnowledgeFS quality-evaluation, task-failure, and related keys outside this change.
- Dify KnowledgeFS staged-upload service test — passed (42 tests), including real `FileService`
  coverage for canonical MIME persistence, expanded formats, and rejection of unsupported or
  extensionless filenames.
- Targeted Ruff format and lint checks for the three changed Python files — passed.
- Targeted Pyrefly checks for the changed Python service files — passed.
- Targeted Mypy was attempted but the installed Mypy 1.20.2 failed internally while reading its own
  `typeshed/stdlib/zipimport.pyi`, before reporting project diagnostics.
- KnowledgeFS `pnpm build` — passed; the existing Next.js multiple-lockfile and ESLint-plugin warnings
  remain unchanged.
- KnowledgeFS `pnpm lint` — attempted but remains blocked by pre-existing formatting/lint failures in
  unrelated Admin, test setup, and generated contract files. No unrelated files were modified; the
  targeted Biome check above covers every KnowledgeFS source and test file changed here.

## Risks and follow-up

- ODT, EML, and MSG parsing still requires a configured and capable Unstructured service, matching
  other complex document types such as DOC and PPT. Upload admission remains independent, while
  downstream parser failures continue to use the existing failed-document lifecycle.
- The added allowlist entries are fixed-size `Set` members. Admission remains constant-time and does
  not change upload byte limits, buffering, database access, or object-storage behavior.
- MDX JSX tags and attributes remain syntax rather than searchable text; visible child text is
  retained, while `script`, `style`, and `noscript` contents remain excluded.
