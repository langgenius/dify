# Admin Workspace Upload 404 Fix

## Summary

- Fixed the Admin BFF path used by `POST /api/bff/knowledge-spaces/workspace/documents`.
- The BFF now resolves the default `workspace` slug through `GET /knowledge-spaces?limit=100` and forwards the upload to the real `KnowledgeSpace.id`.
- Increased the Admin BFF default request body limit from `64 KiB` to `10 MiB`, matching the single-document upload path better.
- Changed the Admin upload form field from `source` to `sourceId`, which is what the API upload parser expects.

## TDD Notes

- Red: added a BFF test for `POST /api/bff/knowledge-spaces/workspace/documents`; it failed because the proxy forwarded `workspace` directly and returned `502` in the test harness.
- Green: added bounded workspace slug resolution before body forwarding, preserving the upload body and Authorization header.

## Operational Notes

- The fix assumes a tenant-scoped KnowledgeSpace with slug `workspace` exists. If it does not exist, the BFF still returns `404 { "error": "Knowledge space not found" }` instead of auto-creating data.
- Slug resolution is intentionally limited to the Admin default `workspace` slug to avoid changing the public API contract for `/knowledge-spaces/{id}` routes.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- lib/bff.test.ts app/page.test.tsx`
  - `pnpm lint`
  - `pnpm check`
  - `pnpm build`
  - `pnpm compose:middleware:config`
  - `git diff --check`
