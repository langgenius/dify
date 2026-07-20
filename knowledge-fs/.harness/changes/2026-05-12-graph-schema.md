# Graph Schema

## What Changed

- Added database schema catalog tables:
  - `graph_entities`
  - `graph_relations`
- Added indexes for:
  - canonical entity deduplication
  - entity listing by type/name
  - outgoing relation traversal
  - incoming relation traversal
  - permission-scope filtering
- Regenerated checked-in PostgreSQL and TiDB initial migration artifacts.

## Why

Sprint 14 needs durable graph storage before extraction outputs can be indexed and traversed. The schema supports entity deduplication and bounded two-direction traversal without scanning all graph edges.

## Performance Notes

- `graph_entities_space_key_uq` supports idempotent canonical entity writes.
- `graph_relations_subject_traversal_idx` supports outgoing expansion by subject entity.
- `graph_relations_object_traversal_idx` supports incoming expansion by object entity.
- Permission-scope indexes preserve the project rule that permission filtering must happen before graph/semantic view exposure.
- All list/traversal indexes include stable tie-breaker columns.

## Verification

- RED:
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts` failed because graph tables and indexes did not exist.
- GREEN:
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts`
  - `pnpm --filter @knowledge/database typecheck`
  - `pnpm db:migrations:write`
  - `pnpm db:migrations:check`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice only adds schema and migration artifacts.
- Graph index write logic and traversal query planning remain in the next Sprint 14 slices.
