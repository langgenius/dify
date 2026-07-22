# KnowledgeFS GC Dry-Run Contracts

## Summary

- Added core GC dry-run candidate, report, and summary schemas.
- Added bounded cleanup candidate types for staged objects, failed commits, artifact segments,
  parse artifacts, index projections, and answer traces.
- Required idempotency keys, reasons, target references, counts, estimated bytes, cursor, and
  non-negative summary fields.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core typecheck`
