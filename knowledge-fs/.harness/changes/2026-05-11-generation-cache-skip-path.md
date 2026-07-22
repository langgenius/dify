# Generation Cache And Skip Path

## What Changed

- Added `createGenerationCache()` to `@knowledge/generation`.
- Added deterministic generation cache keys for the evidence/template/model/version/parameter combination.
- Added `createGenerationSkipPath()` and `GenerationModelUnavailableError`.
- Added skip behavior that returns the cloned `EvidenceBundle` when generation budget is exhausted or the selected model is unavailable.
- Added cache-hit behavior that returns cached `GenerateTextResult` before calling a provider.
- Added tests for cache hits/misses, session-context bypass, malformed/oversized cache entries, cache-key validation, budget skip, model-unavailable skip, and non-skippable provider errors.

## Why

Sprint 7 requires generation reuse when the same evidence, prompt template, model version, and generation parameters are used. It also needs a safe fallback path when budget or model availability prevents answer synthesis, so callers can still receive the underlying EvidenceBundle instead of failing the whole query.

## Performance Notes

- Cache keys are content-addressed and do not include raw query text or raw evidence text.
- Cache entries are bounded by `maxEntryBytes` and TTL-bound by `ttlMs`.
- Session-context prompts bypass cache reads and writes to avoid unsafe reuse.
- Skip decisions happen before provider calls, avoiding unnecessary network and token spend.
- The skip path returns cloned EvidenceBundles and cached results so callers cannot mutate retained state.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`: passed.
- `pnpm --filter @knowledge/generation typecheck`: passed.
- `pnpm --filter @knowledge/generation test:coverage`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- The cache/skip utilities are not yet wired into the `/queries` SSE route. A later query-runtime slice should combine retrieval, prompt rendering, cache lookup, streaming generation, citation normalization, and final response metadata.
- Cache invalidation currently relies on versioned cache keys and TTL. When production index publication and deletion workflows land, they should invalidate or namespace affected generation caches alongside evidence caches.
