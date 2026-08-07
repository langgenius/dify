# Document Outline Detail Fidelity

## What Changed

- Upgraded the native HTML parser to `native-html@2`.
  - The HTML `<title>` value is retained as bounded parse-artifact metadata.
  - `<title>` is no longer emitted as a body parse element, so it cannot create an ordinal-zero
    chunk or a second document-outline root beside the body `<h1>`.
- Made the Dify KnowledgeFS outline response recursively typed. Nested outline children now retain
  their aliases and summaries through validation, OpenAPI generation, and response serialization.
- Connected the Dify document detail page to the persisted document-outline endpoint using the
  selected revision's physical document asset id.
  - The outline hierarchy, rather than a hierarchy inferred only from chunk section paths, owns the
    contents tree when a matching outline version is available.
  - Generated outline summaries are shown with the corresponding section content.
  - Exact materialized section headings are removed from the displayed chunk body while the raw
    indexed/copyable chunk text remains unchanged.
  - Flat chunk labels are one-based.
  - Existing documents with the legacy standalone HTML-title chunk are normalized in the view, so
    they no longer show `#0` / `Chunk 0` or a duplicate root before re-indexing.
- Regenerated the console and service TypeScript contracts from the corrected recursive response
  model.

## Why

The document detail surface previously never requested the persisted PageIndex-style outline. It
constructed a look-alike tree from chunk `sectionPath` values, did not expose generated summaries,
and displayed the heading again as the first line of each chunk. Native HTML parsing also treated
head metadata as body content, producing the visible `Chunk 0` and duplicate root reported by the
user.

## Performance Notes

- Chunks and the immutable outline are requested in parallel; this change adds no request waterfall.
- Outline/chunk association is computed in `O(chunks * section-depth + outline-nodes)` time with
  prefix maps. It does not scan all chunks once per outline node.
- The existing outline response byte limit remains in force. HTML title metadata is capped at 2,000
  Unicode code points.

## Verification

- `pnpm --filter @knowledge/parsers test:coverage`
  - 24 tests passed.
  - 95%+ statements/lines and 90%+ branches.
- `pnpm --filter @knowledge/parsers typecheck`
- `pnpm typecheck` from `knowledge-fs/`
  - All 22 Turbo tasks passed.
- `pnpm test` from `knowledge-fs/`
  - All 22 Turbo tasks passed; the API package alone ran 4,254 passing tests with the existing
    integration-only skips.
- `pnpm build` from `knowledge-fs/`
  - All 12 Turbo build tasks passed, including the production Admin build.
- `uv run --project api pytest -q api/tests/unit_tests/services/test_knowledge_fs_product_dto.py api/tests/unit_tests/controllers/openapi/test_knowledge_fs.py`
  - 54 tests passed.
- `uv run --project api ruff check api/services/knowledge_fs/product_dto.py api/tests/unit_tests/services/test_knowledge_fs_product_dto.py`
- `uv run --project api ruff format --check api/services/knowledge_fs/product_dto.py api/tests/unit_tests/services/test_knowledge_fs_product_dto.py`
- `pnpm --filter @dify/contracts type-check`
- `pnpm exec vp test run features/new-rag/__tests__/document-detail-model.spec.ts features/new-rag/__tests__/document-detail-page.spec.tsx` from `web/`
  - 74 tests passed.
- `pnpm --dir web type-check`
- Targeted Vite+ formatting and lint checks for the changed frontend files.
- `uv run --project api python api/dev/generate_knowledge_fs_contract.py --check`
- `git diff --check`

## Known Risks And Follow-Up

- The physical document-outline endpoint returns the asset's current version. The UI only consumes
  an outline whose version exactly matches the selected logical revision and falls back to the
  existing chunk-derived tree otherwise. A revision-scoped outline endpoint would be needed to
  guarantee outlines for historical revisions whose physical asset has advanced.
- Re-indexing an existing HTML document is still recommended to remove the legacy title chunk from
  persisted retrieval data. The compatibility normalization fixes the current detail view without
  requiring that re-index first.
- Browser runtime verification was not run because the local authenticated Dify/KnowledgeFS stack
  was not active for this workspace. The generated-client boundary and visible behavior are covered
  by the focused component test.
- The repository-wide `pnpm lint` from `knowledge-fs/` remains blocked by 10 pre-existing unrelated
  baseline findings: formatting/import findings in legacy Admin/test files, generated contract JSON
  formatting, and the 1.5 MiB generated OpenAPI document exceeding Biome's 1 MiB processing limit.
  The changed parser files and all changed Dify frontend/Python files pass their targeted checks.
