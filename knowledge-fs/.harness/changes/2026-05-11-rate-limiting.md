# Rate Limiting

## What Changed

- Added a `RateLimiter` contract to the API package.
- Added `createNoopRateLimiter()` as the default gateway behavior so unconfigured runtimes keep existing behavior.
- Added `createInMemoryRateLimiter()` with bounded key storage, fixed-window counters, per-tool overrides, and explicit config validation.
- Gateway protected routes now apply rate limiting after auth by `{ tenantId, subjectId, tool }`.
- Rate-limited requests return `429`, a `retry-after` header, and structured metadata.
- Public `/health` and `/openapi.json` remain outside limiter checks.

## Why

- Phase 2 Sprint 8 requires per-tenant, per-agent, per-tool rate limits for retrieval, KnowledgeFS, document, query, and CRUD surfaces.

## Performance And Safety Notes

- In-memory limiter state is bounded with `maxKeys`.
- Expired windows are pruned before adding new keys to avoid unbounded memory growth.
- Limiter keys use tenant, subject, and normalized low-cardinality tool names; raw paths, queries, JWTs, and request bodies are not stored.
- The limiter runs after auth so anonymous traffic still receives `401` instead of consuming tenant-scoped quota.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createInMemoryRateLimiter` was missing.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This slice adds no Redis/KV backend. Distributed rate limiting remains a runtime adapter follow-up.
- Rate-limit OpenAPI response schemas can be expanded once route-level API docs are consolidated.
