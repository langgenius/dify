# Extract API Answer Trace Recorder

## Summary

- Continued R6 API decomposition by moving AnswerTrace recorder input types, options, max-step validation, trace assembly, and defensive return clone into `packages/api/src/answer-trace-recorder.ts`.
- Kept `AnswerTraceRepository` in the gateway file for now; the repository itself is a larger follow-up boundary with database cleanup semantics.
- Added a code-health guardrail to keep recorder assembly out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/answer-trace-recorder.test.ts src/code-health.test.ts` failed because `answer-trace-recorder.ts` did not exist.
- GREEN: implemented `packages/api/src/answer-trace-recorder.ts`, re-exported it, and removed the recorder implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/answer-trace-recorder.test.ts src/code-health.test.ts src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 3 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
