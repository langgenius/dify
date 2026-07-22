# Repair the core branch coverage gate

Date: 2026-07-16

## Why

The GitHub Actions quality job runs `pnpm check`, and `@knowledge/core` stopped that job because
its branch coverage was 88.02% against the required 90% threshold. The threshold was kept intact;
the gap came from meaningful model-state, command-summary, trace, and adapter-shutdown branches
that did not yet have direct behavioral coverage.

## What changed

- Added pending model configuration tests for:
  - a configuration with no selected model;
  - `pending-validation` carrying failure metadata;
  - `validation-failed` missing required failure metadata.
- Added the first embedding-profile creation path through
  `updateKnowledgeSpaceEmbeddingProfile(undefined, selection)`, including revision and stable
  vector-space identity assertions.
- Added command registry coverage for summaries without optional cache/degradation policies and
  successful execution/trace output without an estimated cost.
- Added platform adapter shutdown coverage for optional cache-level and top-level close hooks,
  including idempotent repeated shutdown.
- No production behavior or coverage threshold was changed.

## Verification

- Red baseline: `pnpm --filter @knowledge/core test:coverage` failed at 88.02% branch coverage.
- Green result: the same command passed with 55/55 tests and 93.10% branch coverage
  (189/203 instrumented branches), plus 98.94% lines/statements and 100% functions.
- `pnpm build` passed for all 11 workspace packages.
- Scoped Biome validation passed for the three changed test files and this change record.
- `git diff --check` passed.

## Known risks and follow-up

- The core coverage failure reported by CI is repaired with 3.10 percentage points of headroom.
- A full `pnpm check` now advances past core and exposes a separate accumulated
  `@knowledge/api` coverage deficit: 82.21% lines/statements, 80.52% branches, and 88.03%
  functions against 90% thresholds. That requires its own API coverage campaign and was not
  hidden by lowering thresholds in this change.
- Repository-wide `pnpm lint` also reports pre-existing Admin/API formatting findings and scans
  the user's untracked API coverage artifacts. None of those unrelated files were modified or
  staged here.
