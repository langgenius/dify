# Extract Research Task Handlers

Date: 2026-05-21

## Summary

- Continued `docs/code-review-issues.md` H1 God File remediation by moving Research Task HTTP handler registration out of `packages/api/src/index.ts`.
- Added `packages/api/src/research-task-handlers.ts` with plan/create/get/partials/events/cancel route registration.
- Left `createKnowledgeGateway` as dependency composition only for this domain: it now calls `registerResearchTaskHandlers({ ... })`.
- Added a code-health guardrail to prevent research task handlers from drifting back into the gateway god file.

## Performance And Safety Notes

- Tenant checks remain server-side and unchanged: every read/write path verifies the authenticated subject tenant before accessing a research task.
- Partials/progress reads keep their existing explicit bounded `limit` behavior.
- Job payload metadata still passes through `toJobPayloadRecord` before enqueue/start, preserving JSON-compatible payload boundaries.
- No database queries or route behavior were added; this is a responsibility-boundary refactor.

## Iteration Plan

- Added the Code Health Track to `.harness/docs/iteration-plan.md`.
- Marked `GF.1 Extract Research Task HTTP handlers` as done.
- Added `GF.2 Extract document write and bulk ingestion handlers` as the next planned God File decomposition slice.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `cargo test --workspace`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `git diff --check`

## Cadence

- This will be implementation commit 1 after review checkpoint `7e5f7e5`.
- The next mandatory 10-commit health review is not due yet.
