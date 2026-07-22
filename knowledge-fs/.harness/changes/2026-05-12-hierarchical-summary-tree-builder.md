# Hierarchical Summary Tree Builder

## What Changed

- Added `SummaryTreeProvider` and `createSummaryTreeBuilder()` to the API package.
- The builder:
  - Loads leaf `KnowledgeNode` records through one bounded `getMany` call.
  - Groups leaves by `sourceLocation.sectionPath`.
  - Generates section-level summary nodes.
  - Generates one document-level summary node from section summaries.
  - Persists all summary nodes through one bounded `createMany` call.
- Summary nodes use `kind: "summary"` and include metadata for:
  - `summaryLevel`
  - child node ids and kinds
  - model and prompt version
  - provider metadata
  - trace id when present
- Added guardrails for max leaf nodes, sections, input chars, summary chars, and output summary nodes.

## Why

Sprint 13 requires a hierarchical summary tree as the next retrieval-quality primitive after contextual enrichment. This slice establishes the reusable builder and persistence boundary without yet wiring summary-tree maintenance or retrieval.

## Performance Notes

- No per-row database query loop is introduced.
- Leaf loading is batched with explicit `maxLeafNodes`.
- Summary persistence is a single `createMany` batch.
- Provider fanout is bounded by `maxSections + 1`.
- Permission scopes are merged onto summary nodes so document summaries remain at least as restrictive as their children under the current `every(scope)` permission filter.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts` failed because `createSummaryTreeBuilder` did not exist.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice does not yet implement incremental summary-tree maintenance.
- This slice does not yet integrate summary nodes into retrieval planning.
- Provider calls are sequential to preserve deterministic ordering and keep fanout bounded; future batching can be added behind the same provider boundary if needed.
