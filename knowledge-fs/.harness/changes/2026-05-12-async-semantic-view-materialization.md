# Async Semantic View Materialization

## What Changed

- Added `createKnowledgeFsTopicViewMaterializer()`.
- Added bounded enqueue/process operations for `knowledgefs.topic-view.materialize` jobs.
- Added `SemanticTopicClusterer` as an injectable clustering boundary for materialized `/knowledge/by-topic` views.
- Added `KnowledgePathRepository.upsertMany()` for one bounded semantic path write per materialization batch.
- Implemented in-memory and database-backed path batch upserts.

## Why It Changed

- Sprint 15 requires semantic views to build in the background without blocking ingestion or KnowledgeFS listing.
- The materializer keeps request-time `/by-topic` listing read-only and lets async workers create semantic `knowledge_paths`.
- Batch loading summary nodes and batch upserting paths avoids N+1 query paths during materialization.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/semantic-view.test.ts` failed because the materializer did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/semantic-view.test.ts`
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

- The clusterer is injectable and contract-tested with a fake provider; production LLM clustering provider wiring remains a follow-up.
- Materialized path cleanup for removed topics/documents is not included in this slice and should be handled by semantic view rebuild/versioning work.
