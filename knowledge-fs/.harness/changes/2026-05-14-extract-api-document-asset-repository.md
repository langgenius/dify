# Extract API Document Asset Repository

## Summary

- Continued R6 API decomposition by moving DocumentAsset repository contracts, bounded in-memory storage, database SQL wiring, row mapping, usage aggregation, parser-status update, delete, and clone isolation into `packages/api/src/document-asset-repository.ts`.
- Kept document asset list/read/write operations tenant-scoped and bounded with explicit `limit` and `maxRows` checks.
- Added a code-health guardrail to keep DocumentAsset repository implementations out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/document-asset-repository.test.ts src/code-health.test.ts` failed because `document-asset-repository.ts` did not exist.
- GREEN: implemented `packages/api/src/document-asset-repository.ts`, re-exported it, and removed the repository implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/document-asset-repository.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 5 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
