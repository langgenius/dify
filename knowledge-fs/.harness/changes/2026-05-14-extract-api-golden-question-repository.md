# Extract API Golden Question Repository

## Summary

- Continued R6 API decomposition by moving `GoldenQuestionRepository`, bounded in-memory storage, database-backed SQL wiring, row mapping, clone helper, and capacity/list-limit errors out of `packages/api/src/index.ts`.
- Kept the public API stable by re-exporting the new module from `@knowledge/api`.
- Added a code-health guardrail so the golden question repository implementation cannot silently drift back into the gateway file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/golden-question-repository.test.ts src/code-health.test.ts` failed because `golden-question-repository.ts` did not exist.
- GREEN: implemented `packages/api/src/golden-question-repository.ts`, updated gateway imports, and removed the moved implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/golden-question-repository.test.ts src/code-health.test.ts src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 1 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
