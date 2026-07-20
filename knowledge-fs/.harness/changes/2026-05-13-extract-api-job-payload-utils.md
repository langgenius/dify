# Extract API Job Payload Utilities

## Summary

- Continued R6 decomposition by moving JSON-compatible job payload validation from `packages/api/src/index.ts` into `packages/api/src/job-payload-utils.ts`.
- Added direct tests for clone isolation, recursive JSON payload validation, and serialization failures such as `BigInt`.
- Added a code-health guardrail so the gateway file does not regain job payload compatibility helpers.

## Why

- Job payload validation is a pure JSON utility and fits the L9 remediation theme of removing duplicated clone/validation patterns from broad files.
- Wrapping serialization failures keeps callers from seeing low-level JSON errors while preserving the existing domain error message.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/job-payload-utils.test.ts src/code-health.test.ts` failed because `job-payload-utils.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/job-payload-utils.test.ts src/code-health.test.ts`
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

- This is a pure utility extraction with one small error-boundary improvement for non-serializable input.
- Continue R6 by extracting more cohesive helpers from `packages/api/src/index.ts`, especially pure formatting, cursor, and path utilities before larger repository moves.
