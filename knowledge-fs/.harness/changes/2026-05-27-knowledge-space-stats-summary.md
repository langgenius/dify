# KnowledgeSpace Stats Summary

## Summary

- Added `GET /knowledge-spaces/{id}/stats` with a bounded `windowMinutes` query for low-cardinality operator counters.
- The stats response includes document storage usage, cache stats, bounded runtime samples, failed commit counters filtered to the requested time window, projection summaries, and an explicit metrics-unavailable marker.
- Reuses the existing status projection summarizer and active session/lease list bounds so stats do not scan raw logs or expose high-cardinality labels.

## TDD Notes

- Added handler coverage proving stats are tenant-scoped, bounded by a 30-minute window, exclude failed commits outside the window, and remain safe when a metrics backend is not configured.
- The response intentionally reports `metrics.available=false` until a durable metrics backend is selected, rather than fabricating performance counters.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api typecheck`
