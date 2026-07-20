# EvidenceBundle Contract

## Summary

- Expanded the core EvidenceBundle contract for Sprint 6 evidence assembly.
- Evidence items now carry structured scores, citations, conflicts, freshness, and metadata.
- Missing evidence is now structured instead of a list of free-form strings.

## Changes

- Added `EvidenceScoresSchema`.
- Added `EvidenceFreshnessSchema`.
- Added `EvidenceConflictSchema`.
- Added `MissingEvidenceSchema`.
- Extended `CitationSchema` with optional `artifactHash`, `startOffset`, and `endOffset`.
- Extended `EvidenceItemSchema` with:
  - `scores`
  - `citations`
  - `conflicts`
  - `freshness`
  - `metadata`
- Updated `EvidenceBundleSchema.missingEvidence` to use structured missing-evidence entries.

## Performance Notes

- This slice is a contract-only change; it introduces no database reads, network calls, or runtime loops.
- Structured evidence metadata prepares the next assembly layer to avoid re-querying citation and score context later.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/core test -- src/models.test.ts`
  - `pnpm --filter @knowledge/core typecheck`
  - `pnpm --filter @knowledge/core test:coverage`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice will be implementation commit 9 after review checkpoint `b7ac774`.
- The next implementation commit after this slice will trigger the required 10-commit health review.
