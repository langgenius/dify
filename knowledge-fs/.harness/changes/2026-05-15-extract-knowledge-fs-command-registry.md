# Extract KnowledgeFS Command Registry

## Summary

- Continued the H1/R6 API god-file decomposition by moving KnowledgeFS command registry wiring and command helpers out of `packages/api/src/index.ts`.
- Added `packages/api/src/knowledge-fs-command-registry.ts` for `ls`, `tree`, `grep`, `find`, `diff`, `open_node`, `cat`, and `stat` command registration plus their cohesive directory/read/render helpers.
- Kept gateway behavior unchanged by re-exporting and importing the new module from the API entrypoint.

## TDD Notes

- RED: added a code-health guardrail requiring `knowledge-fs-command-registry.ts` and confirming `index.ts` no longer owns registry/list/render helper functions.
- GREEN: added focused registry tests for the bounded command list and permission denial before storage dependencies are touched.

## Performance And Safety

- Preserved bounded command registry capacity at 8 commands.
- Preserved explicit command limits, keyset cursors, and batched node loading behavior from the existing implementation.
- Kept permission checks at the command boundary before command handlers access repositories or object storage.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`

## Review Cadence

- This slice is implementation commit 9 after review checkpoint `207c4f3`.
- The next implementation commit will trigger the mandatory 10-commit health review.
