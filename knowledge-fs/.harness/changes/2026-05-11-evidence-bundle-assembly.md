# EvidenceBundle Assembly

## Summary

- Added the first EvidenceBundle assembly boundary for Sprint 6.
- Reranked hybrid retrieval candidates can now be converted into structured core `EvidenceBundle` objects.
- This slice is pure TypeScript assembly logic and does not introduce database, object storage, network, or cache IO.

## Changes

- Added `createEvidenceBundleAssembler()` to `@knowledge/api`.
- Added assembly options:
  - `maxItems`
  - `maxMissingEvidence`
  - `generateId`
  - `now`
- Added assembly behavior for:
  - score breakdowns
  - citations with source offsets
  - freshness metadata
  - structured conflicts
  - projection/source metadata
  - missing expected evidence
  - basic answerability state inference pending the dedicated answerability slice

## Performance Notes

- Assembly is bounded by `maxItems` and `maxMissingEvidence`.
- It consumes already retrieved/reranked candidates and performs no N+1 database lookups.
- It validates through `EvidenceBundleSchema` before returning, keeping downstream generation/cache layers on a stable contract.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
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

- This slice will be implementation commit 10 after review checkpoint `b7ac774`.
- A 10-commit health review is required immediately after this commit is pushed.
