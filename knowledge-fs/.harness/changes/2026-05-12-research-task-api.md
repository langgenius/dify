# Research Task API

## What Changed

- Added authenticated Hono/OpenAPI routes:
  - `POST /research-tasks`
  - `GET /research-tasks/{id}`
  - `DELETE /research-tasks/{id}`
- Wired the routes to `ResearchTaskJobStateMachine`.
- Added default bounded in-memory research task state machine wiring for the gateway.
- Added gateway options for injecting `researchTasks`, deterministic research task ids, and `maxResearchTaskJobs`.

## Why

- Phase 5 Sprint 17 needs create/get/cancel endpoints before partial results, budget tracking, dry-run planning, and MCP research tools can be layered on top.

## Performance Notes

- Create performs one tenant-scoped KnowledgeSpace lookup before enqueueing work.
- The default repository is capped by `maxResearchTaskJobs`.
- The route does not add list APIs or unbounded reads.
- Metadata and permission scope are converted to JSON-compatible job payload records before enqueueing.

## TDD / Verification

- RED: `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `POST /research-tasks` returned `404`.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- Partial results, budgets, dry-run planning, resumability, and MCP research tools are intentionally left for later Sprint 17 slices.
- The Hono OpenAPI handler uses a narrow `any` escape with a documented lint suppression because route inference hits TypeScript TS2589 for this schema; runtime validation still comes from the OpenAPI route schemas.
