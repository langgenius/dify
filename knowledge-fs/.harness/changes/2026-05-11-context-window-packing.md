# Context Window Packing

## What Changed

- Added `ComputeRuntime.packEvidence()` as the TypeScript wrapper for WASM `packEvidenceJson`.
- Added Zod validation for packed evidence context, included items, omitted items, and token accounting.
- Added `createContextWindowPacker()` to `@knowledge/generation`.
- Context packing now splits a model context window into system prompt tokens, evidence token budget, output tokens, and safety margin.
- The packer calls WASM evidence packing only after budget validation succeeds.

## Why

- Sprint 7 generation needs context-window budgeting before prompt templates and SSE generation can safely send evidence to LLM providers.
- Budget splitting keeps model output reservations and system prompts from accidentally crowding evidence beyond a model context limit.

## Performance And Safety Notes

- Budget computation is in-memory and bounded.
- Invalid context windows fail before invoking the evidence packer.
- `ComputeRuntime.packEvidence()` validates all WASM output before returning it to TypeScript callers.
- The implementation does not add database, object-storage, cache, network, or job access.

## Verification

- `pnpm --filter @knowledge/compute test -- src/compute.test.ts`
- `pnpm --filter @knowledge/compute typecheck`
- `pnpm --filter @knowledge/compute test:coverage`
- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation typecheck`
- `pnpm --filter @knowledge/generation test:coverage`

Full workspace verification is recorded in `TEMP-progress-document.md` after completion.

## Known Risks / Follow-Up

- This slice does not yet build evidence-driven prompt templates or stream query responses.
- The next workflow step is a mandatory 10-commit project health review before continuing feature iteration.
