# Admin graph row key collision

## Summary

- Added dedicated row key helpers for Admin live data rows, including graph
  entity and relation traversal rows.
- Updated the Entity browser to include traversal position in graph row keys so
  duplicate graph entity or relation ids do not trigger React duplicate-key
  warnings.
- Removed remaining bare UUID React keys from Admin live lists, workspace
  options, document rows, parse artifact elements, golden questions, trace
  steps, and semantic diff changes.
- Added regression tests for duplicate graph ids and duplicate generic row ids.

## Why

Live Admin APIs can surface duplicate ids inside bounded diagnostic or traversal
pages, especially while projections are being rebuilt. The Admin UI previously
used raw ids as React keys in several lists, which caused duplicate-key warnings
and unsupported reconciliation behavior.

## Verification

- `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/graph-row-keys.ts`
- `pnpm --filter @knowledge/admin typecheck`
