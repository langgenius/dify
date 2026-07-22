# SourceFS Mount Inspection Tools

## What Changed

- Added a bounded in-memory `ResourceMountRepository` for tenant-scoped SourceFS mount lookup.
- Added CommandRegistry-backed SourceFS `ls`, `cat`, and `grep` handlers for `upload` and `object-storage` mounts.
- SourceFS object paths now resolve from `upload://` and `object://` mount prefixes into the shared `ObjectStorageAdapter`.
- Added SourceFS result contracts for list entries, cat output, and grep matches.
- Added tests covering listing synthetic directories, reading mounted objects, grepping mounted text objects, tenant isolation, capability enforcement, bad mount pointers/providers, traversal rejection, capacity limits, and stale object metadata size checks.

## Why

- Phase 2 Sprint 8 requires SourceFS inspection tools so agents can inspect mounted raw sources before using semantic retrieval.
- The tools need to reuse the existing safe CommandRegistry boundary rather than introducing host shell execution or unbounded object-store scans.

## Performance And Safety Notes

- `ls` requires an explicit positive `limit` and rejects limits above `maxListLimit`.
- `grep` searches a bounded object page (`maxGrepObjects`) and returns at most `maxGrepMatches`.
- `cat` and `grep` both check `headObject.sizeBytes` and the actual returned body length against `maxReadBytes`.
- Mount lookup is tenant-scoped and knowledge-space-scoped; cross-tenant access returns no mount.
- Unsupported providers fail closed; this slice intentionally supports only `upload` and `object-storage`.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/sourcefs.test.ts` failed because `createInMemoryResourceMountRepository` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/sourcefs.test.ts`
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

## Known Risks / Follow-Up

- SourceFS is currently exposed as a reusable CommandRegistry boundary, not yet as MCP `knowledge.source.*` tools or Hono routes.
- Grep currently uses bounded object reads rather than provider-native search; provider-specific search can replace this behind the same contract later.
