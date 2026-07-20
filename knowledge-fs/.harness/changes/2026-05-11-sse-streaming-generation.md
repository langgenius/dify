# SSE Streaming Generation

## What Changed

- Added authenticated `POST /queries` as the first streaming answer endpoint.
- Added `QueryGenerator` and query stream event contracts for Gateway-level generation orchestration.
- The route validates JSON body input, checks the subject tenant can access the target KnowledgeSpace, and streams generated answer events as `text/event-stream`.
- SSE events use bounded per-event writes and include the request `traceId`:
  - `answer.delta`
  - `answer.done`
  - `answer.error` for generator failures after the stream starts
- Added OpenAPI coverage for `/queries`.

## Why

- Sprint 7 needs a streaming query boundary after LLM routing, evidence packing, context budgeting, and prompt templates.
- This route gives the next slices a stable Gateway surface for wiring retrieval, prompt rendering, provider streaming, cost tracking, citation normalization, and cache behavior.

## Performance And Safety Notes

- The route streams chunks as they arrive instead of accumulating a full answer in memory.
- Tenant scope is checked with a single KnowledgeSpace repository lookup before streaming starts.
- `POST /queries` is treated as a read-scope operation because it produces an answer stream and does not mutate KnowledgeSpace state.
- Generator failures after the stream begins are converted to a generic SSE error event without leaking stack traces.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test:coverage`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- The route currently depends on an injected `QueryGenerator`; the next generation slice should wire retrieval, prompt rendering, and the LLM router into that generator.
- Cost tracking, citation normalization, generation caching, and skip/degradation behavior remain planned Sprint 7 follow-ups.
