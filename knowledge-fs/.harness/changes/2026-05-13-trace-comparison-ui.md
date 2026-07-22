# Trace Comparison UI

## What Changed

- Added `createTraceComparison()` to the Admin package.
- Added bounded side-by-side trace comparison for route, recall candidates, filters, rerank settings, evidence citation counts, and step count.
- Added delta summaries for recall, citations, routes, rerank changes, and filter changes.
- Added a Trace comparison panel to the Admin Console.
- Expanded the Admin coverage gate to include `lib/trace-comparison.ts`.

## Why It Changed

- Sprint 20 requires operators to compare two query traces for recall, rerank, and evidence differences.
- Keeping the comparison as a bounded pure helper makes trace diffs deterministic and avoids adding unplanned API/database paths.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/trace-comparison.test.ts app/page.test.tsx` failed because the helper and UI were missing.
- Focused verification passed:
  - `pnpm --filter @knowledge/admin test -- lib/trace-comparison.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/admin test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Performance Notes

- Each trace is capped by `maxSteps`.
- Nested trace attributes are ignored in comparison labels to avoid retaining bulky metadata in the Admin view model.
- This slice adds no API route, database query path, or retrieval runtime call.

## Known Risks And Follow-Up

- The current UI uses static sample traces. A later wiring slice can source live trace pairs from the existing trace API without changing the comparison helper contract.
