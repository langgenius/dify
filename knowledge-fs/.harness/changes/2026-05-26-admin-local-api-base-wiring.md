# Admin Local API Base Wiring

## What Changed

- Changed source-local API defaults from port `8787` to `8788` to avoid collisions with workerd-based local services.
- Split Admin API configuration into server-side `KNOWLEDGE_API_BASE_URL` and public/display `NEXT_PUBLIC_API_BASE_URL`.
- Updated the Admin source dev script so `pnpm --filter @knowledge/admin dev` loads the root `.env` before starting Next.
- Updated Compose so the Admin container calls the API service through `http://api:8787` while the UI displays the host API port.
- Added bounded defaults for KnowledgeSpace and GoldenQuestion list query limits so missing `limit` no longer produces a `NaN` validation error.
- Updated the local `.env` in this workspace to point Admin and API at `http://localhost:8788`.

## Why

- The user's local `localhost:8787` was served by another project (`droploft-edge`), causing Admin health, BFF health, upload, and workspace bootstrap to hit the wrong API.
- Compose had the same class of bug: server-side Admin code used a public localhost URL that cannot reach the API container.
- Missing list limits should stay bounded but return a usable default instead of leaking low-level coercion details.

## Verification

- `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts app/page.test.tsx app/document-pages.test.tsx lib/upload-action.test.ts`
- `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts`
- `pnpm compose:apps:test`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-golden-question-schemas.test.ts src/gateway.test.ts src/admin-bff-integration.test.ts`
- Local live check with API on `8788` and Admin on `3100`:
  - `GET http://localhost:8788/health` returned KnowledgeFS component health.
  - `GET http://localhost:3100/api/bff/health` returned KnowledgeFS component health.
  - `POST http://localhost:3100/api/admin-upload` returned a `303` redirect with `uploadStatus=success` and `parserStatus=parsed`.
- `pnpm --filter @knowledge/admin test -- admin-dockerfile.test.ts`

## Known Risks / Follow-Up

- Existing developer machines with an old ignored `.env` must update `API_PORT`, `KNOWLEDGE_API_BASE_URL`, and `NEXT_PUBLIC_API_BASE_URL` to the same host-visible API port.
- Already-running Admin dev servers must be restarted after `.env` changes because Next reads process env at startup.
- AIR.3 still needs to audit preview-only Admin panels so visible controls do not imply unimplemented live behavior.
