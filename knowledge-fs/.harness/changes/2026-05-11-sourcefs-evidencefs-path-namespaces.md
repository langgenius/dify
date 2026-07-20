# SourceFS And EvidenceFS Path Namespaces

## What Changed

- Added `KnowledgeFsNamespaceSchema` for the four Phase 1 filesystem roots:
  - `sources`
  - `knowledge`
  - `evidence`
  - `workspaces`
- Added namespace helper functions:
  - `buildKnowledgeFsPath(namespace, segments)`
  - `getKnowledgeFsPathNamespace(virtualPath)`
  - `getKnowledgeFsNamespaceSpec(namespace)`
- Tightened `KnowledgePath.virtualPath` so records must live under `/sources`, `/knowledge`, `/evidence`, or `/workspaces`.
- Added tests for SourceFS, KnowledgeFS, EvidenceFS, and workspace path construction, namespace parsing, invalid segments, and outside-namespace rejection.

## Why

- Phase 1 Sprint 4 requires SourceFS/EvidenceFS path namespaces before ResourceMount and command registry work can safely build on virtual paths.
- Restricting path roots prevents accidental unscoped virtual paths such as `/tmp` from entering the KnowledgeFS model.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`: passed.
- `pnpm --filter @knowledge/core test:coverage`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks And Follow-Up

- This slice defines namespace semantics only; it does not yet add ResourceMount, filesystem command execution, or path-backed APIs.
