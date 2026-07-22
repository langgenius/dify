# Extract API Safe Shell Boundary

## Summary

- Extracted safe-shell types, command planning, tokenization, transform execution, output bounding, and workspace replay output summarization from `packages/api/src/index.ts`.
- Updated `packages/api/src/safe-shell.test.ts` to import `createSafeShell` directly from `safe-shell.ts`.
- Added a code-health guardrail so safe-shell parsing and transform helpers do not drift back into the gateway file.

## Why

- This continues R6 module decomposition from `docs/code-review-issues.md`.
- Safe-shell parsing is security and performance sensitive: the dedicated module keeps host-shell syntax rejection, pipeline bounds, registry routing, and max output byte enforcement directly testable.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/safe-shell.test.ts src/code-health.test.ts` failed before `safe-shell.ts` existed.
- GREEN focused: `pnpm --filter @knowledge/api test -- src/safe-shell.test.ts src/code-health.test.ts src/gateway.test.ts`

## Notes

- The temporary progress documents were previously removed after iteration-plan completion, so this permanent change summary records the slice.
- Review cadence restarted after checkpoint `f6ceb51`; this is implementation commit 5 after that checkpoint.
