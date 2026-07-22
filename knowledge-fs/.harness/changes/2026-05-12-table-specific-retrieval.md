# Table-Specific Retrieval

## What Changed

- Added `createTableSpecificRetrievalPath()` for bounded table-aware retrieval.
- Tabular queries or explicit table filters trigger one additional `nodeKinds: ["table"]` retrieval leg.
- Table hits are merged and deduplicated with base retrieval, boosted, and annotated with `metadata.tableRetrieval`.
- Retrieval metrics now include `tableCandidates` when table-specific retrieval runs.
- KnowledgeFS table nodes can now be read as:
  - JSON resources, using existing table node text.
  - HTML resources, when the path ends in `.html` or the path metadata has `format: "html"`.
- HTML rendering escapes cell content and falls back to `<pre>` for non-JSON table text.

## Why

- Sprint 15 requires tables to behave as independent retrieval and KnowledgeFS resources.
- Table-specific retrieval gives structured/table nodes a dedicated bounded recall path without changing the underlying index projection tables.
- HTML resources make table nodes inspectable by humans and agents while preserving the existing JSON payload for machine workflows.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts` failed because `createTableSpecificRetrievalPath()` was missing.
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because KnowledgeFS table HTML resources were unsupported.
  - `pnpm --filter @knowledge/api test:coverage` failed below 90% branch coverage before table edge-case tests were added.
- Focused verification:
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

- The table retrieval wrapper adds at most one extra bounded retrieval call and reuses existing dense/FTS repository paths.
- Explicit non-table filters do not trigger table-specific retrieval, so caller constraints are not broadened.
- KnowledgeFS table HTML rendering uses the already-loaded table node and does not query parse artifacts or object storage.

## Known Risks And Follow-Up

- Table intent detection is keyword-based. A later quality iteration can replace this with query planning signals or learned routing.
- HTML rendering supports common JSON table payloads. Rich tables with merged cells, footnotes, and layout boxes will need parser-specific metadata rendering in a later structured-document polish slice.
