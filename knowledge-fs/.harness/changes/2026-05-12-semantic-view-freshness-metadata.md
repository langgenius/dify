# Semantic View Freshness Metadata

## What Changed

- Added live semantic view freshness metadata to `/knowledge/by-entity` entries.
- `/knowledge/by-entity` now exposes `buildStatus`, `generatedVersion`, and `staleStatus` under `metadata.semanticView`.
- `/knowledge/by-topic` topic directories now inherit semantic view metadata from materialized child path records.
- `/knowledge/by-topic/{topicSlug}` keeps returning the materialized resource metadata, including semantic freshness fields.

## Why It Changed

- Sprint 15 requires semantic views to expose generated version, stale status, and build status.
- The metadata is returned on the KnowledgeFS entries themselves so agents and UI clients can reason about view freshness without issuing extra lookups.
- The implementation avoids new queries; freshness is either live metadata for graph-backed `/by-entity` or existing metadata on semantic `knowledge_paths` rows for `/by-topic`.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification before push:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- `/by-entity` uses `generatedVersion: "live"` because it is computed from the current graph index rather than a materialized semantic path snapshot.
- Async semantic view materialization still needs to write fresh/stale/build metadata consistently for `/by-topic`.
