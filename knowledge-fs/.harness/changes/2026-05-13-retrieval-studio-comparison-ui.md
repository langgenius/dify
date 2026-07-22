# Retrieval Studio Comparison UI

## What Changed

- Added `createRetrievalStudioComparison()` to the Admin package.
- Added bounded side-by-side strategy columns for candidate score, rerank score, source labels, evidence state, recall, latency, and evidence bundle status.
- Added deterministic winner selection for two retrieval strategies using recall, average shown candidate score, and latency tie-breaking.
- Added the Retrieval Studio panel to the Admin Console and linked it from navigation.
- Expanded the Admin coverage gate to include the new Retrieval Studio view-model helper.

## Why It Changed

- Sprint 20 requires a Retrieval Studio surface that lets operators compare baseline and challenger retrieval strategies side by side.
- Keeping the comparison as a bounded pure helper makes the UI deterministic, testable, and free of hidden runtime query work.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/retrieval-studio.test.ts` failed because `./retrieval-studio` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/admin test -- lib/retrieval-studio.test.ts`
  - `pnpm --filter @knowledge/admin test -- lib/retrieval-studio.test.ts app/page.test.tsx`
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

- Candidate rendering is capped by `maxCandidates`.
- This slice adds no database, retrieval runtime, or API route execution path.
- No unbounded list API, N+1 database query path, or repeated database waterfall was introduced.

## Known Risks And Follow-Up

- The current Admin panel uses static comparison data; live retrieval strategy selection and trace-backed comparison can be wired in the subsequent Sprint 20 slices.
