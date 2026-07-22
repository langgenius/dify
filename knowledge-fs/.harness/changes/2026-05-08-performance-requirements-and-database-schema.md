# 2026-05-08 Performance Requirements And Database Schema

## Summary

- Recorded the user's high-performance requirements under `.harness/agents`.
- Added a new `@knowledge/database` package.
- Added a database schema catalog for PostgreSQL and TiDB.
- Added SQL renderers for table and index scaffolding.
- Added performance guard tests that ensure required high-traffic query indexes exist.

## Files Added Or Updated

- `.harness/agents/development-requirements.md`
- `.harness/docs/TEMP-task-document.md`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/2026-05-08-performance-requirements-and-database-schema.md`
- `packages/database/package.json`
- `packages/database/tsconfig.json`
- `packages/database/vitest.config.ts`
- `packages/database/src/index.ts`
- `packages/database/src/schema.ts`
- `packages/database/src/schema.test.ts`
- `pnpm-lock.yaml`

## Why

The project has extremely high performance requirements. Database-facing development must avoid N+1 queries, repeated database round-trips, unbounded loads, memory leaks, and missing indexes.

The schema catalog makes table structure and required access-pattern indexes auditable before runtime query code is introduced.

## Performance Guardrails Added

- Tenant/space resolution indexes.
- Source listing by space/status.
- Document asset listing by space/source/version.
- Ingestion status listing by space/status/created time.
- Document deduplication by space/hash/version.
- Parse artifact lookup by asset/version and artifact hash.
- Knowledge node batch loading by space/asset/kind.
- Knowledge node source-order lookup by artifact/offset.
- Permission-scope retrieval filtering index.
- Projection lookup by space/type/status and node/type/version.
- KnowledgeFS virtual path unique lookup.
- Evidence bundle lookup by trace and answerability state.
- Answer trace listing by space/created time.
- Trace-step loading by trace/started time.

## TDD Notes

- Added schema catalog tests before relying on the database package in other code.
- Added a failing test for nullable optional domain relationships:
  - `source_id`
  - `trace_id`
  - `evidence_bundle_id`
- Fixed schema rendering so optional relationships are nullable.

## Verification

- `pnpm --filter @knowledge/database test`: passed.
- `pnpm --filter @knowledge/database test:coverage`: passed.
  - `packages/database`: 100% lines, statements, branches, and functions.
- `pnpm install`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.

## Known Risks And Follow-Up

- This is schema and migration rendering scaffolding, not a live database adapter yet.
- The next database step should decide whether to layer Drizzle definitions on top of this catalog or keep generated SQL as the migration source.
- Runtime repository methods must use batched access and pagination; this package currently prevents missing index regressions but does not execute queries.
