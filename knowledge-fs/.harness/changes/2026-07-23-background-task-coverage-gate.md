# Restore the KnowledgeFS API branch-coverage gate

Date: 2026-07-23

## What changed

- Expanded background-task domain tests across document, source, and bulk-operation state mappings,
  progress calculation, task-kind mapping, and cursor validation.
- Expanded the bulk-operation database repository tests for configuration bounds, record parsing,
  permission-snapshot provenance, pagination, optional fields, and grouped-job lookup behavior.
- Expanded background-task HTTP handler tests for authorization paths, task visibility, missing or
  disappearing resources, unavailable controls, durable permission snapshots, and caller channels.

## Why

The backend implementation added for the overview and background-task APIs introduced valid
production branches while the API package retained a 90% branch-coverage gate. The existing tests
left the package at 89.79%, so GitHub Actions failed after the migration-runner baseline was fixed.

## Verification

- The full `@knowledge/api` coverage suite passed.
- The three focused background-task suites passed: 48 tests.
- API coverage is 93.84% lines, 96.26% functions, and 90.02% branches.
- `@knowledge/api` TypeScript checking passed.
- `pnpm lint:backend` passed across 960 files.
- The generated KnowledgeFS contract lock passed its integrity check.
- `git diff --check` passed.

## Risks and follow-up

- There is no production behavior change and no coverage threshold, exclusion, or generated report
  change. The added tests exercise existing backend contracts and error paths.
- The repository-wide CI workflow remains the final validation for other KnowledgeFS packages,
  contract-lock integrity, Docker builds, and deployment smoke checks.
