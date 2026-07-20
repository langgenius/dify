# WASM RRF Fusion

## What Changed

- Added bounded pure-compute reciprocal-rank fusion to `crates/knowledge_compute`.
- Exported the WASM API as `rrfFuseJson(inputJson)`.
- Added TypeScript compute runtime support through `rrfFuse(input)`.
- Added Zod validation for RRF input and WASM output before callers can consume fused results.

## Why

Sprint 5 hybrid retrieval needs a deterministic fusion primitive that can combine dense, FTS, and future retrieval lists without database, network, or runtime-specific dependencies. Keeping RRF in Rust/WASM preserves the architecture rule that Rust only handles pure compute.

## Performance And Safety Notes

- RRF input size, list count, per-list item count, output candidate count, and response limit are explicitly bounded.
- Duplicate ids inside a single ranked list are ignored after their first occurrence to avoid one source inflating a candidate.
- The implementation performs one pass over bounded ranked lists, aggregates candidates in a bounded hash map, and returns a sorted limited result.
- TypeScript callers receive clone-isolated output and cannot mutate retained runtime state.

## Verification

- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm --filter @knowledge/compute test -- src/compute.test.ts`
- `pnpm --filter @knowledge/compute test:coverage`
- `pnpm --filter @knowledge/compute typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- Retrieval API wiring still needs to call `rrfFuse()` instead of local TypeScript fusion logic.
- Evidence packing and reranking are still separate Sprint 5 follow-up slices.
