# Staged Commit Ledger Foundation

## What Changed

- Added the core `KnowledgeSpaceStagedCommit` model with operation type, status,
  idempotency key, raw/published object keys, optional document/artifact references,
  projection fingerprint, checksum, size, bounded error diagnostics, timestamps, and
  expiry.
- Added a bounded in-memory staged commit repository with tenant/space scoping,
  idempotent create by scoped idempotency key, clone isolation, status filtering,
  stable keyset pagination, capacity guards, and guarded status transitions.
- Added `knowledge_space_staged_commits` to the database schema catalog with cascade
  KnowledgeSpace ownership, optional document/artifact references, scoped idempotency
  uniqueness, status recovery pagination, expiry cleanup, and document-history indexes.
- Regenerated PostgreSQL and TiDB initial migration artifacts.

## Why

The JuiceFS-inspired hardening plan requires a durable ledger for partially completed
ingestion and publication work. This foundation lets future upload, artifact segment,
reindex, projection publish, fsck, and gc flows represent recoverable state explicitly
instead of relying on implicit object-storage side effects.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/api test -- src/staged-commit-repository.test.ts`
- `pnpm --filter @knowledge/database test -- src/schema.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/database typecheck`
- `pnpm db:migrations:check`
- `git diff --check`

## Known Risks And Follow-Up

- The first repository implementation is in-memory only. A database-backed staged commit
  repository is needed before durable source-run ingestion can recover interrupted
  commits across process restarts.
- Upload and worker flows do not yet write staged commit records. That wiring belongs to
  later immutable publication and fsck/gc slices.
