# Failed Query Diagnostics

## What Changed

- Added `createFailedQueryDiagnostics()` to the Admin package.
- Added bounded candidate ranking rows with final rank, final score, retrieval rank, rerank rank, and rerank drop explanations.
- Added bounded filter exclusion rows with reason/source labels.
- Added a Failed query diagnostics panel to the Admin Console.
- Expanded the Admin coverage gate to include `lib/failed-query-diagnostics.ts`.

## Why It Changed

- Sprint 20 requires operators to explain failed queries by inspecting candidate ranking, filter exclusions, and rerank drops.
- A pure Admin view-model helper keeps this diagnostic surface deterministic and avoids hidden API or database work.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/failed-query-diagnostics.test.ts app/page.test.tsx` failed because the helper and UI were missing.
- Focused verification passed:
  - `pnpm --filter @knowledge/admin test -- lib/failed-query-diagnostics.test.ts app/page.test.tsx`
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

- Candidate diagnostics are capped by `maxCandidates`.
- Filter exclusion diagnostics are capped by `maxExclusions`.
- This slice adds no API route, database query, retrieval call, or unbounded list surface.

## Known Risks And Follow-Up

- The current UI uses static diagnostic data. A future live wiring slice can source the same contract from stored AnswerTrace metadata.
