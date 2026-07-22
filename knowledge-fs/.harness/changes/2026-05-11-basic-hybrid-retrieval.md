# Basic Hybrid Retrieval

## What Changed

- Added a database-backed hybrid retrieval repository for ready `index_projections`.
- Dense retrieval runs one bounded parameterized vector query per request.
- FTS retrieval runs one bounded parameterized database-native full-text query per request.
- Added a basic hybrid retriever that executes dense and FTS searches in parallel and fuses candidates with reciprocal rank fusion.
- Added tests for PostgreSQL pgvector SQL, TiDB vector/FTS SQL, bounded `topK`, bounded `limit`, query-vector validation, parameterized SQL, and fused duplicate candidates.

## Why

- Sprint 3 requires a first retrieval path after dense and FTS projections are available.
- The implementation keeps retrieval inside the `DatabaseAdapter` boundary and avoids per-node query waterfalls.
- Explicit `topK`, `limit`, and `maxRows` guardrails prevent unbounded reads and in-memory accumulation.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`: passed.
- `pnpm --filter @knowledge/api test:coverage`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks And Follow-Up

- RRF currently runs in TypeScript as the basic MVP path; the iteration plan allows later WASM RRF hardening.
- Results currently return fused node/projection ids and source labels; citation/source-location enrichment is the next Sprint 3 slice.
