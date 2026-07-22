# Optimized Hybrid Recall

## What Changed

- Extended `createBasicHybridRetriever()` with optional planner and fusion runtime injection.
- Planner-backed retrieval now uses mode-aware dense/FTS fanout for recall while keeping final output bounded by request `limit`.
- Added a WASM-compatible RRF fusion path using ranked dense and FTS lists.
- Added retrieval `plan` and latency/candidate `metrics` to retriever results.
- Kept the existing local RRF fusion path as a fallback when no fusion runtime is injected.

## Why

Sprint 5 needs production retrieval behavior where recall fanout is larger than final answer count, mode choices are explicit, and fusion can use the Rust/WASM RRF primitive added in the previous slice.

## Performance And Safety Notes

- Dense and FTS repository searches still run in parallel with `Promise.all`.
- All search fanout values come from a bounded `RetrievalPlan`; repository calls receive explicit `topK`/`maxRows`.
- Fusion input is bounded with max lists, max items per list, max output items, and max JSON input bytes.
- Metrics expose candidate counts and elapsed durations without raw queries, document text, vectors, or credentials.
- No additional database round trips were introduced.

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

- Runtime wiring still needs to provide a real WASM compute module in application composition.
- Reranker provider integration is still a separate Sprint 5 slice.
- Evaluation comparison between dense-only, FTS-only, and hybrid modes is still pending.
