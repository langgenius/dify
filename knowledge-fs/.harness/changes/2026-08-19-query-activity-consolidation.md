# Query Activity Consolidation

## Summary

- Records one `query.requested` activity when a user starts a query, including the resolved
  retrieval mode and a bounded copy of the question.
- Stops appending `query.completed`, `query.failed`, and `profile.published` activities.
- Excludes historical terminal-query and profile-publication rows from activity-feed reads while
  retaining their storage decoding compatibility.
- Shows the question and retrieval mode directly in recent activity and the complete activity
  drawer.

## Safety and Compatibility

- Query questions are limited to 4,000 characters in activity details; longer values are marked
  as truncated.
- Credentials, tokens, object keys, and the legacy arbitrary `query` detail key remain excluded by
  the activity-detail allow-list.
- Overview answer-rate and outcome calculations continue to use durable AnswerTrace and
  FailedQuery facts rather than the removed terminal activity writes.

## Verification

- `pnpm --filter @knowledge/api test`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm exec vitest run features/new-rag/__tests__/knowledge-overview-page.spec.tsx` (from `web/`)
- `pnpm type-check` (from `web/`)
- `git diff --check`
