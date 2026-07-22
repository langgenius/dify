# Core Stable JSON Utility

## Summary

- Continued R6 by centralizing deterministic JSON rendering in `@knowledge/core`.
- Removed duplicate `stableJson` implementations from embeddings and generation.

## Changes

- Added `packages/core/src/json-utils.ts` with `stableJson`.
- Exported shared JSON utilities from `@knowledge/core`.
- Updated embeddings and generation to import shared `stableJson`.
- Added code-health guardrails so package-local `stableJson` implementations do not return.
- Added `@knowledge/core` as an embeddings workspace dependency.

## Verification

- `pnpm install`
- `pnpm --filter @knowledge/core test -- src/json-utils.test.ts`
- `pnpm --filter @knowledge/embeddings test -- src/embedding-code-health.test.ts src/embedding.test.ts`
- `pnpm --filter @knowledge/generation test -- src/generation-code-health.test.ts src/generation.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/embeddings typecheck`
- `pnpm --filter @knowledge/generation typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Notes

- The shared renderer preserves the existing generation semantics: stable object key order, omitted `undefined` object fields, preserved array order, and explicit `null`.
