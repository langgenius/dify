# API package branch-coverage campaign (85.15% -> 93.51%, threshold restored to 90)

Date: 2026-07-10

Pays down the coverage debt flagged when the branch threshold was ratcheted to 85: six parallel
work streams wrote targeted tests against the exact uncovered branch paths (from the v8 coverage
json), grouped by domain with disjoint files.

## Result
- packages/api branches: **85.15% -> 93.51%** (lines 95.5 / functions 96.5); 1030 tests green.
- `vitest.config.ts` branch threshold **restored 85 -> 90**.
- 20 new `*-coverage.test.ts` files + extensions to 6 existing test files; ~227 new tests.
  Tests only — no production source touched; gateway.test.ts untouched (line budget).

## Per-group coverage of the targeted branch paths
- A knowledge-fs-command-registry + safe-shell: 113/126 (registry 75.7% -> 98.8%)
- B source-handlers/repository/fs-registry/comparison: 98/106 (repo + fs-registry to 100%)
- C retrieval-paths + both query generators + eval runners: 96/114
- D multimodal evaluation/answer-provider/extractor/resolver: 120/127 (two files to 100%)
- E projection builders + pdf rasterizer + outline builder + enrichment: 107/116
- F research-task-job + space/read handlers + graph/projection repos + community: 130/138

## Remaining uncovered branches (~56 across the 26 files)
All individually reviewed and judged unreachable defensive code — dominant patterns:
`?? fallback` after schema/validator guarantees (noUncheckedIndexedAccess artifacts), false arms
of `signal ? {signal} : {}` (fetch Request always has an AbortSignal), switch defaults behind
type guards, and Promise.all results that cannot be sparse. Each group's rationale is recorded in
its task output; do not chase these — refactor them away if they bother anyone.
