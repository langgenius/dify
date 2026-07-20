# Cascading Deletion Lifecycle Foundation

## What Changed

- Added `DocumentDeletionLifecycleRepository` and bounded `createInMemoryDocumentDeletionLifecycleRepository()`.
- Wired bulk document delete to record lifecycle state after derived artifacts, nodes, projections, raw document assets, and object storage are deleted.
- Recorded cache invalidation and trace redaction timestamps alongside tenant, knowledge space, document asset, object key, trace id, and deletion counts.
- Added API gateway tests proving lifecycle records are created only for tenant-scoped successful deletes and that repository retention is bounded.

## Why

- Sprint 12 lifecycle work needs a reusable foundation for cascading document deletion before cleanup jobs and quota enforcement build on it.
- The record gives later cache invalidation, trace redaction, cleanup jobs, and audit flows a deterministic handoff point without retaining unbounded in-memory state.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createInMemoryDocumentDeletionLifecycleRepository` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- This is the lifecycle foundation, not the final cleanup job runner. Sprint 12 cleanup jobs should consume retention policy settings and this deletion lifecycle boundary next.
- The in-memory lifecycle repository is bounded and appropriate for local/dev fallback; durable deployments should later wire it to the database/job execution layer.
