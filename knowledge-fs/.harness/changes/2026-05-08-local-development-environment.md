# Local Development Environment Scaffold

## What Changed

- Added `compose.yaml` for local development services:
  - PostgreSQL with pgvector.
  - MinIO S3-compatible object storage.
  - Self-hosted Unstructured API.
  - Optional API and Admin app containers behind the `apps` profile.
- Added `.env.example` with local-only defaults.
- Added `infra/local/README.md` with local workflow commands and service notes.
- Added root package scripts:
  - `pnpm compose:config`
  - `pnpm dev:infra`
  - `pnpm dev:stack`

## Why

Sprint 1 includes a local development environment for PostgreSQL + pgvector, MinIO, Unstructured, and app startup. This scaffold gives developers a reproducible local stack while keeping runtime secrets in ignored `.env` files.

## TDD Notes

- This is environment configuration, not runtime behavior, so no RED unit test was required.
- Validation used Docker Compose config rendering plus the normal repository verification suite.

## Performance Notes

- PostgreSQL uses the pgvector image so vector/FTS/database-as-search-engine work can be developed locally without adding another search service.
- App containers depend on healthy infrastructure services, avoiding startup waterfalls caused by unavailable dependencies.
- Persistent named volumes avoid repeated dependency/database bootstrap work between local runs.

## Verification

- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm check`: passed.
- `cargo test --workspace`: passed.

## Known Risks / Follow-Up

- Container images are not digest-pinned yet; pinning should happen before production-like CI or release workflows.
- The app containers still use in-memory adapter skeletons until real PostgreSQL/MinIO adapters are implemented.
- MinIO bucket initialization is not automated yet.
