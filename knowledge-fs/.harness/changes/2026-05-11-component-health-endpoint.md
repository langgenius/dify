# Component Health Endpoint

## What Changed

- Extended `/health` to report gateway component health for:
  - parser
  - embedding
  - reranker
  - LLM
- Added `componentHealth` injection to `createKnowledgeGateway()`.
- Component health sources may expose either `health()` or `models()`.
- Adapter health remains reported for database, object storage, cache, and jobs.

## Why

- Phase 2 Sprint 8 requires `/health` to report DB, object store, cache, parser, embedding, reranker, and LLM readiness.

## Performance And Safety Notes

- Component health probes run concurrently with platform health.
- Probe failures are converted to `false` and do not throw out of the endpoint.
- `/health.ok` continues to reflect platform adapter health, while optional provider readiness is visible in `components`.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because parser/embedding/reranker/LLM components were missing from `/health`.
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

- Production provider health can later be backed by real provider clients, circuit-breaker state, or cached health probes.
