# Admin Semantic View Empty State

## Summary

- Updated the Admin Semantic views panel to distinguish unavailable data from reachable-but-empty semantic views.
- When both `/knowledge/by-topic` and `/knowledge/by-entity` load successfully with zero entries, the panel now shows `Not materialized` instead of `Live`.
- Replaced generic empty labels with next-step messages that explain topic-view materialization and entity extraction/graph indexing are required before entries appear.
- Updated the README Admin Console guide with the same caveat.

## Why

Normal document upload creates document assets, parse artifacts, nodes, and projections, but it does not automatically materialize topic views or build graph entities. Showing an empty `Live` panel made that expected pipeline state look like data loss.

## Verification

- `pnpm exec biome check --write apps/admin/app/page.tsx apps/admin/app/page.test.tsx`
- `pnpm --filter @knowledge/admin test -- app/page.test.tsx`

## Risks And Follow-Up

- This is a UI truthfulness fix, not automatic semantic materialization. A follow-up should wire explicit operator controls or jobs for topic-view materialization and entity extraction/graph indexing.
