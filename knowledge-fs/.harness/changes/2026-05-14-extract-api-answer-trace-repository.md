# Extract API Answer Trace Repository

## Summary

- Continued R6 API decomposition by moving AnswerTrace repository contracts, bounded in-memory storage, database SQL wiring, row mapping, cleanup validation, and clone isolation into `packages/api/src/answer-trace-repository.ts`.
- Kept database reads bounded with explicit `maxRows`, database writes parameterized, and cleanup deletes limited by caller-provided `maxTraces`.
- Added a code-health guardrail to keep AnswerTrace repository implementations out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/answer-trace-repository.test.ts src/code-health.test.ts` failed because `answer-trace-repository.ts` did not exist.
- GREEN: implemented `packages/api/src/answer-trace-repository.ts`, re-exported it, and removed the repository implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/answer-trace-repository.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 4 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
