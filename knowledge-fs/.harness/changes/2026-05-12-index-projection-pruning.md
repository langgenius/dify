# Index Projection Pruning

## What Changed

- Added `IndexProjectionRepository.pruneInactiveVersions({ knowledgeSpaceId, type, retainVersions, maxProjections })`.
- Implemented bounded in-memory pruning for inactive `stale` and `failed` projections outside the newest retained projection versions.
- Implemented database-backed pruning with parameterized SQL, explicit `maxRows`, and a stable retained-version subquery.
- Added tests covering max deletion bounds, retained-version behavior, ready projection preservation, invalid retention config, and DB parameterization.

## Why

- Sprint 12 cleanup jobs need a projection cleanup primitive before broader cleanup scheduling can safely remove stale index state.
- The current index projection schema does not include `updated_at`, so this slice intentionally prunes by inactive version retention instead of pretending age-based expiration exists.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `pruneInactiveVersions` did not exist.
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

- This is a repository cleanup primitive only; it is not yet scheduled by a cleanup worker.
- Day-based stale projection expiration needs a future schema migration or lifecycle timestamp before it can be implemented honestly.
