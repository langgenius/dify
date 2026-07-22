# AnswerTrace Recording

## Summary

- Added AnswerTrace recording boundaries for Sprint 6.
- Trace persistence records normalize, route, recall, filter, rerank, and evidence stages as bounded steps.

## Changes

- Added `AnswerTraceRepository`.
- Added `createInMemoryAnswerTraceRepository()`.
- Added `createDatabaseAnswerTraceRepository()`.
- Added `createAnswerTraceRecorder()`.
- Database persistence writes:
  - one `answer_traces` row
  - one batched `answer_trace_steps` insert for all steps
- Database reads use explicit `maxRows` and stable step ordering.
- In-memory persistence enforces `maxTraces` and `maxSteps`.
- Recorder enforces `maxSteps` before persistence and returns `AnswerTraceSchema`-validated output.

## Performance Notes

- Step writes are batched rather than one database call per step.
- Trace reads use indexed `trace_id + started_at + id` ordering.
- Step metadata is JSON only; raw document bytes and document text are not written.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice will be implementation commit 5 after review checkpoint `f950b59`.
- The next 10-commit review is not due yet.
