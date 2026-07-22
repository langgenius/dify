# Research Task Progress Streams

## Summary

- Added a bounded research task progress event repository and publisher.
- Wired research task lifecycle transitions to progress events and optional webhook dispatch.
- Added an authenticated SSE endpoint for tenant-scoped progress replay/follow.

## Key Changes

- Added `packages/api/src/research-task-progress.ts`.
- Added `createInMemoryResearchTaskProgressRepository()` with explicit `maxEvents`, `maxListLimit`, and `maxSubscribers` bounds.
- Added `createResearchTaskProgressPublisher()` so lifecycle transitions can publish events and dispatch webhooks.
- Wired `createResearchTaskJobStateMachine()` to emit started, stage changed, paused, resumed, canceled, and failed events.
- Added `GET /research-tasks/{id}/events` with read-scope auth, tenant isolation, explicit `limit`, cursor support, and `text/event-stream` responses.
- The SSE route sends at most `limit` events per request and then closes, allowing cursor-based reconnects without unbounded connection retention.

## Performance Notes

- Progress storage is bounded by `maxEvents`.
- Subscriber count is bounded by `maxSubscribers`.
- Reads require explicit positive limits and enforce `maxListLimit`.
- Subscribers use waiter-based delivery rather than polling; cancellation releases pending waits immediately.
- The API endpoint filters by `tenantId + researchTaskJobId` before returning events and does not expose tenant ids in SSE payloads.
- Webhook dispatch is optional and runs only after the event has been durably appended to the injected repository.

## TDD

- RED first:
  - `packages/api/src/research-task-progress.test.ts` initially failed because the progress module did not exist.
  - Gateway tests initially failed because `/research-tasks/{id}/events` was not registered.
- GREEN coverage includes lifecycle publishing, webhook dispatch, tenant-scoped subscription filtering, bounded repository validation, SSE auth, cross-tenant 404 behavior, OpenAPI registration, and bounded replay/follow stream behavior.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-progress.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- A future runtime wiring slice can connect the optional webhook dispatcher to a signed outbound delivery adapter.
- The current SSE endpoint intentionally uses bounded replay/follow semantics; clients should reconnect with the returned sequence cursor strategy as the UI integration matures.

## Review Cadence

- This will be implementation commit 6 after reviewed checkpoint `55f83ef`.
