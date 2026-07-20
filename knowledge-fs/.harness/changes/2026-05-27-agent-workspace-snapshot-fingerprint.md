# Agent Workspace Snapshot Fingerprint

## Summary

- Added `buildAgentWorkspaceSnapshotFingerprint`, producing stable `snapshot-sha256:*`
  fingerprints from manifest version, permission snapshot, source versions, path versions, and
  projection fingerprint.
- Added snapshot `fingerprint`, `manifestVersion`, and `pathVersions` fields, with compatible
  defaults for existing create flows.
- Updated API/MCP schemas and handlers so snapshots can carry reproducible read pins without
  caller-supplied tenant overrides.
- Added bounded `maxPathVersions` support to the in-memory snapshot repository.

## Verification

- `pnpm --filter @knowledge/api test -- src/agent-workspace-snapshot.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
