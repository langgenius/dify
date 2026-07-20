# Generation Cost Tracking

## What Changed

- Added `createGenerationCostTracker()` to `@knowledge/generation`.
- Added model/provider pricing configuration with a required `priceVersion`.
- Added `withGenerationCostTracking()` provider wrapper that annotates non-streaming results and streaming terminal events with cost metadata when provider usage is available.
- Added cost metadata fields for prompt tokens, completion/output tokens, total tokens, input/output USD cost, total USD cost, provider, model, currency, and pricing version.
- Added validation for blank price versions, duplicate prices, missing prices, invalid pricing values, and invalid token usage.

## Why

- Sprint 7 requires generated responses to carry retrieval/generation cost breakdowns before query streaming can be production-ready.
- Keeping the calculation in the generation package allows API routes, SSE generators, and future caches to share one deterministic cost boundary.

## Performance And Safety Notes

- Cost estimation is pure arithmetic over returned provider usage and does not add network, database, cache, filesystem, or object-storage work.
- Pricing lookup is a single in-memory map lookup keyed by provider/model.
- The wrapper preserves provider streaming behavior and only annotates the terminal `done` event.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation typecheck`
- `pnpm --filter @knowledge/generation test:coverage`
- `pnpm lint`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Known Risks / Follow-Up

- Live provider pricing should be updated through configuration before production use.
- The query generator wiring still needs to expose this cost metadata through `POST /queries` terminal SSE events.
