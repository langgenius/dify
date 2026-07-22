# Admin Operation Diagnostics

## Summary

- Added a read-only `GET /knowledge-spaces/{id}/leases/active` API route for bounded active KnowledgeFS lease diagnostics.
- Reused the existing staged commit diagnostics route for failed commit visibility from Admin.
- Extended the Admin API client with bounded `listStagedCommits()` and `listActiveLeases()` methods.
- Extended the Admin BFF allowlist for read-only staged commit and active lease diagnostics.
- Added an Operations diagnostics panel showing failed commit and active lease page counts, cursor availability, and compact current-page rows.

## TDD Notes

- API diagnostics coverage now checks active lease list access, limit enforcement, and OpenAPI path exposure.
- Admin client coverage proves both diagnostics lists are fetched with explicit limits.
- BFF coverage proves diagnostics routes are read-only and query params are preserved.
- Admin page coverage proves diagnostics requests use the active workspace id and remain server-side through the configured API base.

## Verification

- `pnpm exec biome check --write packages/api/src/core-resource-response-schemas.ts packages/api/src/knowledge-space-golden-question-schemas.ts packages/api/src/knowledge-space-routes.ts packages/api/src/knowledge-space-handlers.ts packages/api/src/knowledge-space-control-plane-diagnostics.test.ts apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/lib/bff.ts apps/admin/lib/bff.test.ts apps/admin/app/page.tsx apps/admin/app/page.test.tsx apps/admin/app/globals.css`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts lib/bff.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/admin typecheck`
