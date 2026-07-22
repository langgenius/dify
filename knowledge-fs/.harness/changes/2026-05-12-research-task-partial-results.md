# Research Task Partial Results

## What Changed

- Added `ResearchTaskPartialResultRepository` contracts.
- Added bounded in-memory partial result storage with:
  - `append(input)`
  - `list({ researchTaskJobId, tenantId, limit, cursor })`
- Added authenticated `GET /research-tasks/{id}/partials`.
- Wired default bounded partial-result storage into the gateway.
- Added OpenAPI schema/path coverage for the partial results endpoint.

## Why

- Sprint 17 requires accumulated research evidence to remain fetchable while a task is running and after a task is canceled.

## Performance Notes

- The repository is capped by `maxResults`.
- Reads require an explicit `limit` and enforce `maxListLimit`.
- Pagination uses a monotonic sequence cursor and stable ascending order.
- The API verifies task ownership once and then performs one bounded partial-result list call.
- No task list endpoint or unbounded evidence read surface was added.

## TDD / Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts` failed because `createInMemoryResearchTaskPartialResultRepository` was missing.
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `GET /research-tasks/{id}/partials` returned `404`.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts packages/api/src/research-task-job.ts packages/api/src/research-task-job.test.ts`
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

- This slice stores partial results in the bounded in-memory repository by default. Durable database-backed storage can be added when the research task persistence layer lands.
- Partial result creation is currently repository-level for worker use; no public append route was added.
