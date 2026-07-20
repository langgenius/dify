# Agent Research E2E

## Summary

- Added an end-to-end agent research test across MCP, the API gateway, workspace snapshots, partial evidence, and the budgeted research workflow.
- The test verifies that an agent can plan research, create a task, snapshot the workspace, read partial evidence, and receive a cited report.

## Key Changes

- Added `packages/api/src/agent-research-e2e.test.ts`.
- The test shares one bounded research task state machine, partial-result repository, snapshot repository, and gateway.
- The MCP client path covers `knowledge.research.plan`, `knowledge.research.create`, and `knowledge.workspace_snapshot.create`.
- The API path covers authenticated `GET /research-tasks/{id}/partials`.
- The workflow path covers retrieve -> compare -> conflict -> freshness -> citation report.

## Performance Notes

- The E2E uses bounded in-memory repositories and explicit list limits.
- Partial reads remain paginated and tenant-scoped.
- The test does not add runtime fan-out, new database queries, or new production code paths.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/agent-research-e2e.test.ts` initially failed on planner wiring and citation shape mismatches, then passed after aligning the E2E fixture with existing contracts.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/agent-research-e2e.test.ts`
  - `pnpm exec biome check --write packages/api/src/agent-research-e2e.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`

## Full Verification

- Passed before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This will be implementation commit 5 after reviewed checkpoint `55f83ef`.
