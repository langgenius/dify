# Cloudflare Job Queue Adapter

## Summary

- Added a Cloudflare-oriented `JobQueueAdapter` implementation that wraps the durable contract with Queue delivery and Durable Object-like state persistence boundaries.
- Wired the Cloudflare platform factory to accept injectable Queue binding and state store test doubles.
- Kept a no-op local skeleton path for development and tests when real Cloudflare bindings are not available.

## Changes

- Added `createCloudflareJobQueueAdapter()` in `@knowledge/adapters`.
- Added portable binding contracts:
  - `CloudflareQueueBinding` with `send(body, options)`.
  - `CloudflareJobStateStore` with `put(jobId, record)`.
- `enqueue()` now stores job state and sends a bounded queue message containing job id, type, attempts, and idempotency key.
- `runAfter` maps to Cloudflare Queue `delaySeconds`.
- `lease()`, `dequeue()`, `heartbeat()`, `fail()`, `retry()`, `complete()`, and `cancel()` persist updated job state.
- Duplicate idempotency-key enqueues return the existing job without sending a duplicate Queue message.
- `createCloudflarePlatformAdapter()` accepts `jobQueue` and `jobStateStore` injection for tests and future Workers runtime wiring.

## Guardrails

- Queue messages do not include raw payload bytes or large document content.
- State persistence receives clone-isolated `JobRecord` snapshots from the underlying bounded queue.
- The local no-op binding path is explicitly a skeleton; real Cloudflare Queues and Durable Objects binding configuration remains a later runtime/deployment slice.
- Bounded lease, batch, queued-job, and terminal-retention limits are inherited from the durable inline implementation.

## Verification

- RED first:
  - `pnpm --filter @knowledge/adapters test -- src/adapters.test.ts` failed because `./cloudflare-job-queue` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/adapters test -- src/adapters.test.ts`
  - `pnpm --filter @knowledge/adapters typecheck`
  - `pnpm --filter @knowledge/adapters test:coverage`
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

- This slice is review checkpoint `92f4e22` + implementation commit 10 after commit and push.
- A mandatory 10-commit health review must run immediately after this commit is pushed.
