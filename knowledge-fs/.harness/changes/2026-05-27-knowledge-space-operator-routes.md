# KnowledgeSpace Operator Routes

## Summary

- Added API routes for the JH.5 operator surface:
  - `GET /knowledge-spaces/{id}/fsck`
  - `GET /knowledge-spaces/{id}/gc/staged-objects`
  - `POST /knowledge-spaces/{id}/gc/staged-objects/execute`
  - existing `status` and `stats` routes are now covered as part of the full operator API surface.
- Wired fsck routes to the raw object, artifact segment, and reference checkers with bounded per-run limits.
- Wired staged object GC dry-run to the existing GC preview service and staged object GC mutation to the lease-aware executor.
- Added OpenAPI response schemas for fsck reports, GC dry-run reports, and staged object GC execution results.
- Extended gateway options with a GC dry-run id generator so tests and deployments can keep reports auditable.

## TDD Notes

- Added route-level coverage proving:
  - OpenAPI documents fsck, GC, status, and stats paths.
  - fsck and GC dry-run are read-scope endpoints.
  - staged object GC execute requires write scope.
  - requests are tenant-scoped and return 404 for spaces outside the subject tenant.
  - staged object GC execute deletes only the candidates supplied by the dry-run contract.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts src/knowledge-fs-fsck.test.ts src/knowledge-fs-gc.test.ts`
- `pnpm --filter @knowledge/api typecheck`
