# KnowledgeFS Reference FSCK

## Summary

- Added a reference fsck checker for bounded KnowledgeFS path, node, and ready projection scans.
- Checked physical path targets against document assets, nodes, and parse artifacts.
- Checked knowledge nodes against their document asset and parse artifact targets, including artifact
  hash consistency.
- Checked ready projections for missing node targets and emitted stale projection issues.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-fsck.test.ts`
- `pnpm --filter @knowledge/api typecheck`
