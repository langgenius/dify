# LLM Routing

## What Changed

- Added `createLlmRouter()` to `@knowledge/generation`.
- Added fast/deep/research route modes with configurable provider, model, output-token ceiling, and optional temperature.
- Added routed non-streaming generation that annotates result metadata with route mode, policy version, and provider key.
- Added routed streaming generation that passes delta events through and annotates terminal events with routing metadata.
- Added tests for valid routing, stream routing, and invalid policy configuration.

## Why

- Sprint 7 requires generation model selection to be policy-driven before evidence packing, prompt templates, streaming query APIs, and cost tracking are wired.
- Retrieval/generation modes should choose provider/model policy centrally rather than scattering model conditionals through gateway code.

## Performance And Safety Notes

- Route selection is pure in-memory config lookup and does not perform network, database, or object-storage work.
- Policy output-token ceilings are applied before provider calls; caller-provided lower limits are allowed, but higher limits are clamped to policy.
- Invalid policies fail during router creation where possible, and missing mode policies fail before any provider call.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation typecheck`
- `pnpm --filter @knowledge/generation test:coverage`

Full workspace verification is recorded in `TEMP-progress-document.md` after completion.

## Known Risks / Follow-Up

- Runtime configuration wiring is not included yet; current router is an injectable library boundary.
- Later Sprint 7 work must connect this router to evidence packing, prompt templates, SSE query endpoints, and generation cost tracking.
