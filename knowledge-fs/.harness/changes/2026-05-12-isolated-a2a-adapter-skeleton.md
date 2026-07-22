# Isolated A2A Adapter Skeleton

## Summary

- Added an experimental isolated A2A adapter skeleton for Phase 5.
- The adapter is intentionally outside core contracts and outside the main Knowledge Gateway route tree.

## Key Changes

- Added `createA2AAdapter()` as a standalone Hono app factory.
- Added `GET /.well-known/agent-card.json` for an A2A-style agent card.
- Added `POST /a2a/tasks` for bounded task submission.
- Added injected `taskHandler`, deterministic `generateTaskId`, deterministic `now`, and text-size bounds for tests/runtime wiring.
- Exported the adapter from `@knowledge/api` without adding it to `@knowledge/core`.

## Performance Notes

- Task submissions are bounded by `maxMessageTextBytes` before handler invocation.
- Invalid or oversized requests fail before invoking downstream work.
- The skeleton does not persist tasks, perform fan-out, or enqueue jobs; real task lifecycle wiring remains a later slice.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/a2a-adapter.test.ts` failed because `./a2a-adapter` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/a2a-adapter.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm exec biome check --write packages/api/src/a2a-adapter.ts packages/api/src/a2a-adapter.test.ts packages/api/src/index.ts`
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

- This will be implementation commit 4 after reviewed checkpoint `55f83ef`.
