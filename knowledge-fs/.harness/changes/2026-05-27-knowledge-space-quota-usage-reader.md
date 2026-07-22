# KnowledgeSpace Quota Usage Reader

## Summary

- Added a reusable KnowledgeSpace quota usage reader for bounded usage accounting across raw assets, parse artifacts, artifact segments, knowledge nodes, and projection summaries.
- Exported the reader from the API package so later admission-control slices can enforce the expanded manifest quota policy without duplicating repository scans.
- The reader reports raw document bytes/count from the asset usage aggregate, artifact segment bytes/count from current parse artifacts, node count from bounded node listing, projection count from low-cardinality projection summaries, and a `truncated` flag when any bounded read has more data.
- Fixed numeric cursor handling for segment pagination by treating `nextCursor !== undefined` as the truncation signal.

## TDD Notes

- Added coverage proving:
  - usage is read across assets, artifacts, segments, nodes, and projections.
  - bounded segment reads mark usage as truncated and only account for the returned page.
  - invalid reader bounds and invalid projection versions fail closed.

## Verification

- `pnpm exec biome check --write packages/api/src/knowledge-space-quota-usage.ts packages/api/src/knowledge-space-quota-usage.test.ts packages/api/src/index.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-quota-usage.test.ts`
- `pnpm --filter @knowledge/api typecheck`
