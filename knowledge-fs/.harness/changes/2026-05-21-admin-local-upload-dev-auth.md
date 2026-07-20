# Admin Local Upload Dev Auth

## Summary

- Fixed the local Admin upload flow so `POST /api/bff/knowledge-spaces/workspace/documents` can work from the browser without a manually supplied Bearer token.
- The Admin BFF now injects a local dev token when a request has no `Authorization` header and `NODE_ENV` is not `production`.
- The standalone API app accepts the same local dev token outside production through a static dev auth verifier.
- When the default `workspace` slug does not exist, the BFF creates a tenant-scoped `Workspace` knowledge space before forwarding the upload to the real space id.

## TDD Notes

- Red: added a BFF test for uploading to `/knowledge-spaces/workspace/documents` without auth and with no existing workspace; it failed with `404`.
- Green: added local auth injection, API dev auth wiring, and idempotent default workspace creation for the Admin placeholder route.

## Safety Notes

- Implicit dev auth is disabled when `NODE_ENV=production` unless an explicit local token is configured.
- Production deployments should configure real auth instead of relying on the local dev token.
- Workspace auto-create is limited to the Admin default `workspace` slug path and does not change the public API route contract.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- lib/bff.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/api-app test`
  - `pnpm lint`
  - `pnpm check`
  - `pnpm build`
  - `git diff --check`
