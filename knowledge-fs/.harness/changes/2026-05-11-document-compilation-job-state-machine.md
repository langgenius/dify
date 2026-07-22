# DocumentCompilationJob State Machine

## Summary

- Added the Phase 3 durable ingestion `DocumentCompilationJob` state machine.
- The state machine starts document compilation work through `JobQueueAdapter` and enforces the ordered pipeline:
  `queued -> parsed -> nodes_generated -> projection_built -> smoke_eval_passed -> published`.

## Changes

- Added `packages/api/src/document-compilation-job.ts`.
- Added `DocumentCompilationJob`, stage types, repository contract, and in-memory bounded repository.
- Added `createDocumentCompilationJobStateMachine()` with:
  - `start()` to create a compilation job and enqueue `document.compile` work.
  - `advance()` to enforce ordered stage transitions.
  - `fail()` to mark failed and notify the underlying queue with optional retry time.
  - `cancel()` to mark canceled and notify the underlying queue.
  - `get()` returning clone-isolated state.
- Exported the state machine boundary from `@knowledge/api`.

## Guardrails

- Repository capacity is bounded by `maxJobs`.
- Stage transitions are strict and terminal states cannot be advanced.
- Queue payloads are compact identifiers and version fields only; no raw document bytes or parsed content are enqueued.
- Idempotency key includes tenant, space, document asset, and version.
- Returned records are clone-isolated.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/document-compilation-job.test.ts` failed because `./document-compilation-job` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/document-compilation-job.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is implementation commit 2 after reviewed checkpoint `3b9b4d8` once committed and pushed.
- The next 10-commit health review is not yet due.
