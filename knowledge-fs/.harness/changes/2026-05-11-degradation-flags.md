# Degradation Flags

## What Changed

- Added configured hybrid retrieval degradation policies:
  - dense failure can degrade to FTS-only retrieval.
  - FTS failure can degrade to dense-only retrieval.
  - reranker failure can degrade by skipping rerank and returning fused candidates.
- Added low-cardinality `degradationFlags` to retrieval metrics when fallback paths are used.
- Added LLM router fallback policies for primary provider failures.
- LLM generate and stream paths now mark fallback routing metadata as degraded with fallback source provider and error class.
- Validation now rejects invalid LLM fallback provider, model, and output-token settings.

## Why

- Phase 2 Sprint 8 requires provider failures to degrade through configured fallback paths instead of always failing closed.

## Performance And Safety Notes

- Retrieval legs still execute concurrently and remain bounded by existing topK/planner limits.
- Degradation metrics store only fixed flag strings and error class names; raw queries, prompts, provider payloads, and stack traces are not recorded.
- LLM stream fallback only occurs before any primary stream output is emitted, avoiding mixed-provider partial answers.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because dense retrieval failures still escaped.
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts` failed because LLM fallback policies were not implemented.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/generation typecheck`
  - `pnpm --filter @knowledge/generation test:coverage`
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

- Provider health scoring/circuit breaking is still a future runtime concern.
- Embedding query creation fallback should be wired when the production query embedding runtime is introduced.
