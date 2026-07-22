# Knowledge Space CRUD API Skeleton

## What Changed

- Added OpenAPI-backed KnowledgeSpace CRUD routes to the Hono gateway:
  - `POST /knowledge-spaces`
  - `GET /knowledge-spaces`
  - `GET /knowledge-spaces/{id}`
  - `PATCH /knowledge-spaces/{id}`
  - `DELETE /knowledge-spaces/{id}`
- Added a bounded in-memory `KnowledgeSpaceRepository` skeleton for Sprint 2 API behavior before durable database execution lands.
- Added tenant-scoped slug uniqueness, explicit list limits, stable slug cursor pagination, and repository capacity bounds.

## Why

Sprint 2 starts moving the gateway from health/OpenAPI scaffolding toward real platform resources. KnowledgeSpace CRUD is the first tenant-scoped resource boundary and sets the shape for later database-backed handlers.

## TDD Notes

- RED: Gateway tests first referenced `createInMemoryKnowledgeSpaceRepository()` and the new CRUD routes before implementation.
- GREEN: Added the repository skeleton, OpenAPI route schemas, and route handlers.
- REFACTOR: Kept list operations bounded and tenant-scoped from the first implementation.

## Performance Notes

- List requests require explicit `tenantId` and bounded `limit`.
- The in-memory skeleton enforces `maxSpaces` and `maxListLimit`.
- Tenant slug lookup is linear only inside the bounded skeleton; durable database implementation should use the existing `knowledge_spaces_tenant_slug_uq` unique index.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`: passed.
- `pnpm --filter @knowledge/api typecheck`: passed.
- `pnpm --filter @knowledge/api test:coverage`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- This is an in-memory API skeleton. The next durable step should replace repository persistence with database adapter execution backed by existing schema/index guarantees.
- Auth middleware is still pending; this slice accepts `tenantId` in the request body/query until server-side subject attachment lands.
