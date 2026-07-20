# KnowledgeFS `/by-topic`

## What Changed

- Added `KnowledgePathRepository.listSemanticDescendants()` for bounded semantic KnowledgeFS path listing.
- Implemented in-memory and database-backed semantic descendant reads with stable `virtualPath + id` keyset pagination.
- Added KnowledgeFS `ls` support for `/knowledge/by-topic`.
- `/knowledge/by-topic` now lists already materialized semantic topic directories.
- `/knowledge/by-topic/{topicSlug}` now lists materialized document resources for that topic.

## Why It Changed

- Sprint 15 requires semantic KnowledgeFS topic views.
- This slice exposes the read surface over materialized semantic paths without doing synchronous LLM clustering in request handling.
- The implementation reuses the existing indexed `knowledge_paths` view access pattern and keeps listing explicitly bounded.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because semantic descendant listing did not exist and `/knowledge/by-topic` returned physical paths.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
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

- This slice reads already materialized semantic paths; the async topic materializer and freshness metadata remain follow-up Sprint 15 tasks.
- Topic directory metadata is currently derived from child resources in future work; root directory entries remain structural.
