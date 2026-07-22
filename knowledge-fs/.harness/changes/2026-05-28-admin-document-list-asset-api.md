# Admin Document List Asset API

## Summary

- Added `GET /knowledge-spaces/{id}/documents` as a bounded, tenant-scoped document asset list endpoint.
- Updated the Admin API client with `listDocuments()`.
- Changed the Admin document list page to read document assets directly instead of using `KnowledgeFS /fs/ls?path=/sources/documents`.
- The document list now stays independent from KnowledgeFS virtual path view/index availability, avoiding gateway-level failures when refreshing the page.

## TDD Notes

- Added API coverage for paginated document asset listing without requiring a KnowledgeFS path view.
- Updated Admin client coverage for the new document list request and response parser.
- Updated Admin document page coverage to assert the list page calls `/knowledge-spaces/{id}/documents`.

## Verification

- `pnpm exec biome check --write packages/api/src/document-request-schemas.ts packages/api/src/document-response-schemas.ts packages/api/src/document-read-routes.ts packages/api/src/document-read-handlers.ts packages/api/src/gateway-document-write.test.ts apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts 'apps/admin/app/documents/[spaceId]/page.tsx' apps/admin/app/document-pages.test.tsx`
- `pnpm --filter @knowledge/api test -- src/gateway-document-write.test.ts`
- `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts app/document-pages.test.tsx`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/admin typecheck`
- `git diff --check`

## Risks And Follow-Up

- Existing tests still intentionally emit one `Unhandled gateway error` line from the gateway unexpected-error regression case. That log is unrelated to the document list route.
