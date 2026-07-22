# Extract API Retrieval Evaluation Runners

## Summary

- Extracted retrieval evaluation runner implementations from `packages/api/src/index.ts` into `packages/api/src/retrieval-evaluation-runners.ts`.
- Moved advanced judge input validation, strategy comparison, A/B comparison, impact evaluation, and candidate-to-result helper logic with the runners.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing retrieval evaluation runners from drifting back into the gateway.

## Why

- Continues R6 code review remediation by separating evaluation orchestration from gateway route construction.
- Keeps bounded retrieval evaluation logic directly testable and easier to review for performance regressions.

## TDD

- RED: added a code-health guardrail first; it failed because `retrieval-evaluation-runners.ts` did not exist.
- GREEN: extracted runner contracts, implementations, and helper functions, then reran focused gateway/code-health tests.

## Performance Notes

- Preserved bounded `maxQuestions`, `maxTopK`, `limit`, and advanced judge context byte checks.
- Kept per-question retrievals batched with `Promise.all`, matching previous behavior without adding N+1 database calls beyond the existing explicit retrieval calls.
- Preserved validation that embedding providers return exactly one dense vector per question.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 9 after review checkpoint `0e46d78`; the next mandatory 10-commit review is due after one more implementation commit.
