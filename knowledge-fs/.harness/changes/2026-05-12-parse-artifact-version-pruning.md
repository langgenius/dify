# Parse Artifact Version Pruning

## What Changed

- Added `ParseArtifactRepository.pruneDocumentVersions({ documentAssetId, keepVersions, maxArtifacts })`.
- Implemented bounded in-memory pruning that keeps the newest document artifact versions and deletes older versions.
- Implemented database-backed pruning with parameterized SQL and explicit `maxRows`.
- Added tests covering retention behavior, bounds, and parameterized database SQL.

## Why

- Sprint 12 cleanup jobs need parse artifact retention enforcement based on the existing retention policy contract.
- Version pruning is an early cleanup primitive that can be invoked by cleanup workers without unbounded artifact scans.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `pruneDocumentVersions` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- This adds the repository pruning primitive but does not yet schedule artifact cleanup jobs across document sets.
- The next cleanup slice should wire cleanup workers over bounded document batches and continue with stale projection/session/trace retention.
