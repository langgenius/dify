# KnowledgeSpace Manifest Foundation

## What Changed

- Added the core `KnowledgeSpaceManifest` domain model with explicit storage provider,
  metadata dialect, object key prefix, parser/node/projection versions, retention policy,
  quota policy, consistency policy, encryption policy, and manifest version fields.
- Added `createDefaultKnowledgeSpaceManifest` for deterministic default manifest creation.
- Added a bounded in-memory `KnowledgeSpaceManifestRepository` with clone isolation,
  tenant/space scoping, stable pagination, mutable-policy updates, duplicate protection,
  and capacity guards.
- Added a manifest bootstrap flow that creates a default manifest when a new
  KnowledgeSpace is created and lazily creates one when a legacy KnowledgeSpace is read.
- Added `knowledge_space_manifests` to the database schema catalog with a cascade foreign
  key to `knowledge_spaces`, tenant/space uniqueness, and stable pagination indexes.
- Regenerated PostgreSQL and TiDB initial migration artifacts.

## Why

The JuiceFS-inspired hardening plan makes metadata the operational control plane for
KnowledgeFS. A first-class KnowledgeSpace manifest gives later staged commits, artifact
segments, consistency classes, fsck/gc, quota, and projection publication work a stable
place to anchor storage, version, cache, retention, and compatibility decisions.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-manifest-repository.test.ts src/knowledge-space-manifest-bootstrap.test.ts`
- `pnpm --filter @knowledge/database test -- src/schema.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/database typecheck`
- `pnpm db:migrations:check`
- `git diff --check`

## Known Risks And Follow-Up

- The first durable slice adds schema support but does not yet add a database-backed
  manifest repository. Durable source-run deployments can persist the table once that
  repository is added in a follow-up slice.
- The manifest is bootstrapped internally but is not yet exposed through a public
  operator API. That belongs with the later status/fsck/operator tracks.
