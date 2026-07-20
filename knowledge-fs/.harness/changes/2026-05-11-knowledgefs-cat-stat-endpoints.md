# KnowledgeFS `cat` and `stat` Endpoints

## What Changed

- Added authenticated `GET /knowledge-spaces/{id}/fs/cat`.
- Added authenticated `GET /knowledge-spaces/{id}/fs/stat`.
- Wired both commands through `CommandRegistry`.
- Added exact path resolution over `KnowledgePathRepository.get()`.
- Extended `KnowledgeNodeRepository` with tenant/space-scoped `get({ id, knowledgeSpaceId })`.
- Implemented `cat` for:
  - document paths backed by bounded object storage reads,
  - knowledge node paths backed by direct node lookup.
- Implemented `stat` for:
  - path metadata,
  - document asset size, hash, MIME type, parser status, and version.
- Added OpenAPI schemas and tests for document/node cat, stat, missing paths, missing targets, unsupported cat targets, and database-backed node lookup.

## Why It Changed

- Sprint 4 requires `cat` and `stat` after `ls/tree` so agents can inspect KnowledgeFS leaves without jumping into semantic retrieval.
- The implementation keeps filesystem semantics behind the same command registry used by `ls/tree`.

## Performance Notes

- Exact reads perform one path lookup plus at most one target lookup.
- Database-backed node reads use parameterized SQL with `knowledge_space_id + id` and `maxRows: 1`.
- Object content reads stay behind `ObjectStorageAdapter`, which already enforces bounded object reads.
- No list scan, N+1 query loop, or host shell execution path was introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage`

## Known Risks / Follow-Up

- `cat` currently supports document objects and knowledge nodes. Parse artifacts, table JSON/HTML, page files, and metadata-specific virtual files remain follow-up work.
- Binary document rendering is not specialized yet; this slice returns decoded text for object-backed document paths.
