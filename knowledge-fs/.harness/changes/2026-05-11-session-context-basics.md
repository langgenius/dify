# Session Context Basics

## Summary

- Added cache-backed query session context for `/queries`.
- Session context now tracks TTL, previous queries, active document ids, active entity ids, and permission snapshot invalidation.
- Query generation receives a bounded `sessionContext`; SSE responses include `x-session-id`.

## Changes

- Added `SessionContextRepository` and `createCacheSessionContextRepository()` in `@knowledge/api`.
- Extended `QueryGenerationInput` with optional `sessionContext`.
- Extended `POST /queries` request schema with optional `sessionId`, `activeDocumentIds`, and `activeEntityIds`.
- Wired the gateway to record session context before streaming generation.
- Added focused tests for query session propagation, TTL expiry, previous query truncation, active resource bounds, clone isolation, malformed cache handling, permission invalidation, and unsafe input rejection.

## Guardrails

- Session storage uses `CacheAdapter` with TTL; no unbounded scans are introduced.
- Cache keys are digest-based across tenant, subject, knowledge space, and session id.
- Previous query, active document, and active entity lists are bounded.
- Query text byte length is capped before storing session history.
- Permission snapshot changes reset previous queries and active resources before generation receives context.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createCacheSessionContextRepository()` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
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

- This slice is review checkpoint `92f4e22` + implementation commit 7 after commit and push.
- The next 10-commit health review is not yet due.
