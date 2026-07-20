# Admin Staged Object GC Controls

## Summary

- Added Admin API client methods for staged-object GC dry-run reads and candidate execution.
- Extended the Admin BFF allowlist for read-only GC dry-run and staged-object execute routes.
- Added a Staged object GC panel showing dry-run candidate counts, estimated bytes, dry-run id, cursor availability, and compact candidate rows.
- Added a dedicated Admin execution route that requires a KnowledgeSpace id, dry-run id, candidate payload, and matching candidate idempotency key before calling the API mutation endpoint.

## TDD Notes

- Admin client tests prove dry-run and execute requests hit the expected API routes and execute sends only explicit candidates.
- BFF tests prove GC dry-run and execute paths are narrowly allowlisted.
- Admin page tests prove dry-run data is loaded for the active workspace.
- Admin action route tests prove mutation is rejected without an idempotency key and only succeeds after a dry-run-derived candidate is submitted.

## Verification

- `pnpm exec biome check --write apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/lib/bff.ts apps/admin/lib/bff.test.ts apps/admin/app/page.tsx apps/admin/app/page.test.tsx apps/admin/app/api/admin-gc-staged-object/route.ts apps/admin/app/admin-action-routes.test.ts`
- `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts lib/bff.test.ts app/admin-action-routes.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
