# KnowledgeFS `ls` and `tree` Endpoints

## What Changed

- Added authenticated `GET /knowledge-spaces/{id}/fs/ls`.
- Added authenticated `GET /knowledge-spaces/{id}/fs/tree`.
- Wired both endpoints through the core `CommandRegistry` with `ls` and `tree` command handlers.
- Extended `KnowledgePathRepository` with bounded `listPhysicalDescendants()` for prefix-scoped physical view traversal.
- Implemented in-memory and database-backed descendant listing over the existing `knowledge_paths_space_view_path_idx` access pattern.
- Added OpenAPI response schemas for KnowledgeFS list and tree responses.
- Added tests for:
  - OpenAPI path exposure,
  - tenant-scoped `ls` and `tree`,
  - bounded list/tree limits,
  - missing tenant-space hiding,
  - invalid path and cursor rejection,
  - repository prefix listing with parameterized SQL and explicit `maxRows`.

## Why It Changed

- Sprint 4 requires paginated KnowledgeFS directory listing before later `cat`, `stat`, MCP, and safe shell work can reuse the same filesystem command surface.
- The implementation keeps route behavior behind `CommandRegistry` instead of adding scattered command semantics.

## Performance Notes

- `ls` and `tree` require explicit `limit`.
- Repository reads use `limit + 1` with `maxRows` to detect truncation without unbounded reads.
- Database-backed prefix traversal remains indexed by `knowledge_space_id`, `view_type`, `view_name`, `virtual_path`, and `id`.
- SQL uses parameter arrays; user-provided paths/cursors are not interpolated into SQL.
- The current tree endpoint builds only from a bounded descendant page, not from a full corpus scan.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage`

## Known Risks / Follow-Up

- Directory pagination currently follows underlying `KnowledgePath` cursor semantics; later large-directory work may add directory-level cursors to avoid repeated virtual directory entries across pages.
- `cat` and `stat` endpoints remain the next Sprint 4 slice.
