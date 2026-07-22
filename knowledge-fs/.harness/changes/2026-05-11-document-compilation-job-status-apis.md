# Document Compilation Job Status APIs

## Summary

- Added Phase 3 Sprint 10 status and cancel APIs for durable document compilation jobs.
- The APIs are protected by existing auth middleware, tenant-scoped, and backed by the injected `DocumentCompilationJobStateMachine`.

## Changes

- Added `GET /jobs/{id}` to read a document compilation job.
- Added `DELETE /jobs/{id}` to cancel a non-terminal document compilation job.
- Added OpenAPI schemas and path entries for job status/cancel.
- Added `/jobs` auth, rate-limit, and trace route wiring.

## Guardrails

- `GET /jobs/{id}` requires `knowledge-spaces:read` or `knowledge-spaces:*`.
- `DELETE /jobs/{id}` requires `knowledge-spaces:write` or `knowledge-spaces:*`.
- Cross-tenant job access returns 404 to avoid leaking resource existence.
- Missing job runtime returns 503 instead of silently pretending job state exists.
- Cancel delegates to the state machine and underlying queue, preserving terminal-state protection.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `/jobs/{id}` returned 404 before the routes existed.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
- Full verification:
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is implementation commit 4 after reviewed checkpoint `3b9b4d8` once committed and pushed.
- The next 10-commit health review is not yet due.
