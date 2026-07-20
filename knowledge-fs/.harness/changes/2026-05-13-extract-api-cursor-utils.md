# Extract API Cursor Utilities

## Summary

- Continued R6 API decomposition by moving graph entity, KnowledgeFS path, and golden question cursor codecs into `packages/api/src/cursor-utils.ts`.
- Moved `KnowledgeFsValidationError` into the same boundary so invalid cursor handling keeps the existing validation-error `instanceof` behavior.
- Added direct round-trip and invalid-cursor tests, including separator escaping.
- Added a code-health guardrail so cursor codecs and the validation error do not move back into `packages/api/src/index.ts`.

## Why

- Cursor parsing is request-boundary logic. Keeping the codecs small and tested makes pagination behavior easier to audit and prevents accidental 500s for malformed cursors.
- The extracted functions preserve existing string formats, so no persisted cursor contract changes.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/cursor-utils.test.ts src/code-health.test.ts` failed because `cursor-utils.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/cursor-utils.test.ts src/code-health.test.ts src/gateway.test.ts src/sourcefs.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Risks And Follow-Up

- Cursor formats remain compact pipe-delimited strings for backwards compatibility. If externally exposed cursors need stronger opacity later, this module is now the single upgrade point.
