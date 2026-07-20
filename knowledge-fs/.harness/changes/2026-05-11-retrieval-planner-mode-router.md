# Retrieval Planner And Mode Router

## What Changed

- Added `createRetrievalPlanner()` to the API package.
- Added retrieval plan contracts for `fast`, `deep`, `research`, and `auto`.
- Added bounded dense/FTS fanout, fusion limits, and rerank candidate limits.
- Added low-cardinality `retrieval.plan` trace spans for route decisions.
- Added tests covering fast, deep, research, auto, CJK/mixed-language routing, fanout bounds, validation, and trace safety.

## Why

Sprint 5 needs a routing layer before hybrid recall optimization and reranking. This planner gives the retrieval runtime a deterministic strategy decision without mixing mode heuristics into database query code.

## Performance And Safety Notes

- `topK` is validated and capped by `maxTopK`; derived dense/FTS/fusion fanout never exceeds the configured bound.
- The planner is pure TypeScript compute with no database or network calls.
- Trace attributes intentionally omit raw query text and only record low-cardinality mode, language, and bounded fanout fields.
- Auto routing uses simple query features for now; future evaluation slices can tune these thresholds without changing retrieval repositories.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- The planner is not yet wired into `createBasicHybridRetriever()`; Sprint 5 `2.5.4` should use the plan to drive dense/FTS fanout and WASM RRF fusion.
- Auto-mode heuristics are intentionally conservative until golden evaluation comparisons are available.
