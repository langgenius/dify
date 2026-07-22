# Auth Subject Middleware

## What Changed

- Added the shared `AuthSubject` contract for `subjectId`, `tenantId`, and scopes.
- Added Bearer-token auth verifier support:
  - `createJwtAuthVerifier` validates signed JWTs with `jose`.
  - `createStaticAuthVerifier` supports tests and local/dev injection.
- Protected `/knowledge-spaces` routes while keeping `/health` and `/openapi.json` public.
- Removed client-supplied `tenantId` from KnowledgeSpace create/list API inputs.
- Hardened in-memory KnowledgeSpace repository get/update/delete operations with tenant-scoped ids.

## Why

KnowledgeSpace CRUD must not trust tenant identity supplied by callers. This slice establishes the server-side subject boundary required before durable database execution and later permission filtering.

## TDD Notes

- RED: Gateway tests first asserted 401/403 responses, server-derived tenant ids, cross-tenant isolation, and JWT subject derivation before implementation.
- GREEN: Implemented subject schema, JWT/static verifiers, auth middleware, route wiring, and tenant-scoped repository methods.
- REFACTOR: Kept auth scope checks centralized in middleware and retained explicit bounded list behavior.

## Security / Performance Notes

- Business routes now require authenticated subjects and route tenant scope from trusted middleware context.
- Cross-tenant reads, updates, and deletes return 404 instead of leaking resource existence.
- List requests remain bounded by explicit `limit` and tenant-scoped filtering.
- This is still an in-memory repository skeleton; durable database execution must use indexed tenant/id or tenant/slug access paths.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/core test:coverage`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- JWT support uses a shared secret verifier only; JWKS/OIDC discovery remains a later integration.
- Local app wiring currently has no dev auth verifier, so protected business routes correctly return 401 until a dev auth mode is intentionally added.
