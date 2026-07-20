# Retention Policy Config API

## What Changed

- Added tenant-level `GET/PATCH /retention-policy`.
- Added knowledge-space-level `GET/PATCH /knowledge-spaces/{id}/retention-policy`.
- Added `RetentionPolicyRepository` and bounded `createInMemoryRetentionPolicyRepository()`.
- Added OpenAPI entries for tenant and space retention policy configuration.

## Why

- Sprint 12 lifecycle work needs explicit tenant/space retention settings before cleanup jobs and quotas can enforce them.
- The architecture defaults are now represented in code instead of remaining only in documentation.

## Performance And Safety

- The default repository is bounded by `maxPolicies`.
- Space-level reads/writes first resolve the tenant-scoped KnowledgeSpace, so cross-tenant policy access returns `404`.
- Policy values are positive integers, except `rawDocumentRetentionDays: null`, which preserves indefinite raw asset retention.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because retention routes and `createInMemoryRetentionPolicyRepository` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
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

- The default implementation is in-memory. A database-backed retention policy repository should be wired before relying on these settings across restarts.
- Cleanup jobs and quota enforcement are separate follow-up slices that will consume this policy contract.
