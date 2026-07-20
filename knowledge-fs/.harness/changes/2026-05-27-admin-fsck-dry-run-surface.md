# Admin FSCK Dry-Run Surface

## Summary

- Added a bounded Admin API client method for `GET /knowledge-spaces/{id}/fsck`.
- Extended the Admin BFF allowlist for read-only fsck diagnostics.
- Added an FSCK dry run panel to the Admin home page for raw object consistency checks.
- The panel shows summary counts, cursor availability, and current-page issues without exposing repair or mutation actions.

## TDD Notes

- Admin client tests prove fsck requests include the explicit `check=raw-objects` mode and parse issue summaries.
- BFF tests prove fsck diagnostics are GET-only through the allowlist.
- Admin page tests prove fsck diagnostics are loaded for the active workspace through the server-side API base.

## Verification

- `pnpm exec biome check --write apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/lib/bff.ts apps/admin/lib/bff.test.ts apps/admin/app/page.tsx apps/admin/app/page.test.tsx`
- `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts lib/bff.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
