# Review Checkpoint f7581f5 Citation Grouping Fix

## Summary

- Completed the mandatory 10-commit project health review after checkpoint `f7581f5`.
- Reviewed implementation commits through `f04584d`.
- Found and fixed one source attribution issue in the new comparison/conflict flow.

## Review Scope

- Technical direction:
  - Research task dry-run planning, limits, resumability, workspace snapshots, MCP/API tools, source comparison, conflict detection, freshness checking, and budgeted workflow remain aligned with Phase 5 Sprint 17-18.
  - Recent slices kept runtime dependencies injectable and avoided adding accidental database/provider/network work.
- Performance:
  - New services use explicit `max*` bounds for fan-out, payload size, citations, snapshots, partial results, and detector output.
  - Budget and limit checks happen before retrieval in the budgeted workflow.
  - No N+1 database paths were introduced in these pure service slices.
- Tests and coverage:
  - API coverage remains above the 90% project gate.
  - Full verification passed before the 10th implementation commit.
- Traceability:
  - Each implementation slice has a corresponding `.harness/changes` entry.

## Finding

- Source comparison flattened `sourceLocations` across evidence nodes, while conflict detection reconstructed node-to-citation ownership by array index.
- When one evidence node had multiple citations, conflict detection could attach a citation to the wrong node or drop a later node's citation in the final conflict report.

## Fix

- Added optional `sourceLocationsByNodeId` to `SourceComparisonFinding`.
- Source comparison now emits grouped citations alongside the existing flat `sourceLocations` field.
- Conflict detection now prefers grouped node citations and falls back to the previous flat/index behavior for compatibility.
- Added regression tests for grouped multi-citation evidence.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/conflict-detection.test.ts src/source-comparison.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/source-comparison.ts packages/api/src/source-comparison.test.ts packages/api/src/conflict-detection.ts packages/api/src/conflict-detection.test.ts`
- Full verification passed before remediation commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Cadence

- Reviewed checkpoint: `f04584d`.
- Remediation commit: `55f83ef`.
- Next implementation cycle should count from the remediation commit after it lands.
