# Summary Tree Incremental Maintenance

## What Changed

- Added `createSummaryTreeMaintenanceFlow()` for rebuilding changed summary branches.
- Added `KnowledgeNodeRepository.upsertMany()` so deterministic summary node ids can be safely rebuilt without duplicate-key conflicts.
  - In-memory repository overwrites existing ids while preserving capacity bounds.
  - Database-backed repository uses dialect-specific upsert SQL.
- Summary tree builder now persists summary nodes through `upsertMany`.
- Incremental maintenance:
  - Loads all leaf nodes in one bounded `getMany` call.
  - Detects affected sections from `changedLeafNodeIds`.
  - Reuses existing unaffected section summaries through one bounded `getMany` call.
  - Regenerates changed or missing section summaries.
  - Regenerates the document summary from the ordered section summaries.
  - Persists rebuilt section summaries and the document summary through one bounded `upsertMany`.

## Why

Sprint 13 requires changed branches to rebuild without regenerating every section summary. This keeps provider cost bounded to affected sections plus the document summary while preserving deterministic summary node identity.

## Performance Notes

- No per-node database query loop is introduced.
- Provider calls are bounded by affected sections plus one document summary.
- Existing section summaries are fetched as a batch by deterministic ids.
- `maxChangedLeafNodes`, `maxLeafNodes`, `maxSections`, and `maxSummaryNodes` bound all maintenance work.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts` failed because `upsertMany` and `createSummaryTreeMaintenanceFlow` did not exist.
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

- The maintenance flow still needs a job/API wiring layer.
- Summary-tree retrieval integration remains a separate Sprint 13 task.
