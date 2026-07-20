# Admin Control Plane Panel

## Summary

- Added read-only Admin API client methods for `GET /knowledge-spaces/{id}/manifest` and `GET /knowledge-spaces/{id}/status`.
- Extended the Admin BFF allowlist so only `GET` manifest/status control-plane routes can be proxied.
- Added a Control plane panel to the Admin home page showing manifest version, storage provider, object prefix, parser policy, projection set version, storage usage, document count, and active sessions.
- Kept unavailable states explicit when the API cannot provide manifest/status data during server render.

## TDD Notes

- Added Admin client coverage proving manifest/status requests are authenticated, bounded through the shared JSON reader, and parsed into UI-safe records.
- Added BFF coverage proving read-only manifest/status routes are allowed and mutation attempts remain rejected.
- Extended Admin page tests to assert manifest/status loads use the active workspace id and public display still stays separate from the private upstream base.

## Verification

- `pnpm exec biome check --write apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/lib/bff.ts apps/admin/lib/bff.test.ts apps/admin/app/page.tsx apps/admin/app/page.test.tsx`
- `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts lib/bff.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
