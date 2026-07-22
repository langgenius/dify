# Final Documentation

## What Changed

- Added `docs/api-reference.md` with the public/business API route map, auth and scope expectations, error semantics, ingestion/query/evaluation/KnowledgeFS/job/retention/snapshot boundaries, and operational notes.
- Added `docs/operator-manual.md` with daily health checks, release checklist, tenant/auth operations, ingestion/retrieval/evaluation workflows, KnowledgeFS operations, retention, incident response, rollback, observability, Admin workflows, and escalation rules.
- Updated `README.md` to point to the API reference, deployment guide, operator manual, and local infrastructure guide.
- Linked the deployment guide back to the API reference and operator manual.

## Why It Changed

Sprint 20 final documentation requires complete API, deployment, and operator documentation. The deployment guide and README existed, but the API reference and operator manual were missing as standalone documents.

## Verification

- RED first:
  - `test -f docs/operator-manual.md && test -f docs/api-reference.md && rg -q "Operator Manual|API Reference" README.md` failed because the new docs and README links were missing.
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Performance Notes

- Documentation now explicitly calls out bounded list/read/upload/queue behavior, no N+1 hot paths, explicit database limits, cache key dimensions, safe trace attributes, and CI regression thresholds.

## Known Risks And Follow-Up

- API schemas should continue to be treated as generated truth from `/openapi.json`; this Markdown reference is an operator-friendly map and must be kept synchronized when routes change.
