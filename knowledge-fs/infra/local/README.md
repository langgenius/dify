# Local Development Environment

This compose stack is the Sprint 1 local scaffold for the standalone target.

## Services

- PostgreSQL with pgvector on port `5432`. The `vector` extension is enabled automatically on a fresh data volume by `infra/local/postgres-init/01-enable-pgvector.sql` (mounted into `/docker-entrypoint-initdb.d`), so `pnpm local:db:migrate` succeeds without a manual step.
- MinIO S3-compatible object storage on ports `9000` and `9001`.
- A one-shot MinIO bootstrap container that creates `${MINIO_BUCKET:-knowledge-fs}`.
- Self-hosted Unstructured API on port `8000`.
- Optional API and Admin app containers behind the `apps` profile.

## Commands

```bash
pnpm dev:infra
```

Starts PostgreSQL, MinIO, the MinIO bucket bootstrap, and Unstructured from `infra/local/compose.middleware.yaml`.
This is the preferred local mode when the API and Admin Console should run from the checked-out source tree on the host.

```bash
pnpm local:db:migrate
```

Applies checked-in PostgreSQL migrations to the configured `DATABASE_URL` before running the source API against database-backed repositories. Migrations are **not** run by the API container, the Docker entrypoint, or on server startup — run this explicitly after the database is up. The initial migration relies on the `vector` extension; on a fresh volume the init script above provides it. If your Postgres volume predates that script, enable it once with:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml exec postgres \
  psql -U "${POSTGRES_USER:-knowledge_fs}" -d "${POSTGRES_DB:-knowledge_fs}" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

### Full Docker Compose startup

```bash
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps up -d --build
```

`pnpm dev:stack` runs the same full stack in the foreground when you want attached Compose logs.

Starts PostgreSQL, MinIO, the MinIO bucket bootstrap, Unstructured, the production API container, and the production Admin Console container.

Default local endpoints:

- Admin Console / control panel: `http://localhost:3000`
- API health: `http://localhost:8788/health`
- Admin BFF health: `http://localhost:3000/api/bff/health`
- MinIO console: `http://localhost:9001`
- Unstructured API: `http://localhost:8000`

If a default host port is already in use, override only the conflicting port for the startup command:

```bash
API_PORT=8787 ADMIN_PORT=3003 UNSTRUCTURED_PORT=8002 docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps up -d --build
```

The API service is built from `apps/api/Dockerfile` as `knowledge-fs-api:local` and runs the standalone Hono server. The Admin service is built from `apps/admin/Dockerfile` as `knowledge-fs-admin:local` and runs the Next.js standalone server.

If Docker Hub auth or rate limiting blocks another build and the app images already exist locally, start from cached local images without rebuilding:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps up -d --no-build
```

Use the same port overrides with `--no-build` when needed:

```bash
API_PORT=8787 ADMIN_PORT=3003 UNSTRUCTURED_PORT=8002 docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps up -d --no-build
```

Verify the full stack after startup:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps ps
curl http://localhost:${API_PORT:-8788}/health
curl http://localhost:${ADMIN_PORT:-3000}/api/bff/health
```

For the source-run local happy path, keep `pnpm dev:infra` running and start these in separate
terminals:

```bash
pnpm local:db:migrate
pnpm dev:api
pnpm --filter @knowledge/admin dev
pnpm local:happy-path
```

`pnpm dev:api` loads `infra/local/.env` automatically, so it sees the same database, object storage, and local auth settings used by `pnpm local:db:migrate`.

The smoke command validates Compose config, Admin build, API health, Admin BFF health, workspace bootstrap,
single Markdown upload through the Admin BFF proxy, document status read, parse artifact read, and a bounded query evidence
check without manual database edits. Set `LOCAL_SMOKE_ADMIN_BASE` when the Admin dev server is not running at `http://127.0.0.1:3000`.
Set `LOCAL_SMOKE_SKIP_ADMIN_BUILD=1` to skip the Admin build when you only want to recheck the live API/upload/artifact path.
Set `LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path` when you want the smoke run to apply checked-in PostgreSQL migrations before API health, upload, artifact, and query checks.
Run `pnpm local:happy-path:durable` when you want the smoke to require `DATABASE_URL`, MinIO env, healthy database, and healthy object storage instead of silently accepting memory fallback.
Run `pnpm local:happy-path:api` when you want the same bounded API upload, artifact, and query evidence checks without requiring the Admin dev server or Admin BFF.

```bash
pnpm compose:config
```

Validates the resolved compose configuration without starting containers.

```bash
pnpm compose:middleware:config
pnpm compose:middleware:test
```

Validates the middleware-only Compose file and asserts that it does not include `api` or `admin`.

```bash
pnpm compose:apps:test
```

Validates the full app profile contract for API image build wiring, middleware readiness dependencies, and the Admin source-run BFF base URL without starting containers.

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml up -d minio minio-bootstrap
pnpm test:minio
```

Runs the live MinIO object-storage smoke test against the bootstrapped local bucket.

## Notes

- Runtime secrets are intentionally local defaults only. Put overrides in `infra/local/.env`, which is ignored by git.
- Copy `infra/local/.env.example` to `infra/local/.env` for a fresh local setup. The tracked example leaves provider API keys blank.
- With the default `infra/local/.env.example` values, source-run Node can use PostgreSQL through `DATABASE_URL`, database-backed core repositories unless `KNOWLEDGE_DATABASE_REPOSITORIES=off`, MinIO through `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY`, and local Admin-to-API auth through `KNOWLEDGE_DEV_AUTH_TOKEN`.
- In the full Docker stack the Admin container also receives `KNOWLEDGE_DEV_AUTH_TOKEN` so its server-side BFF can authenticate to the API. Because the Admin image runs with `NODE_ENV=production`, without this token `getAdminServerToken()` returns `null` and the token-gated panels (Control plane, Operations diagnostics, Publish readiness) render as "Unavailable". The default matches the API service so both resolve to `dev-token` unless overridden in `infra/local/.env`.
- First run against an empty database: after `pnpm local:db:migrate`, the Admin Console still has no knowledge space, so per-space panels show "Unavailable". Create one (or upload a document, which bootstraps a space) to populate them. The default active workspace is the space whose slug is `workspace`:

  ```bash
  curl -X POST -H "Authorization: Bearer ${KNOWLEDGE_DEV_AUTH_TOKEN:-dev-token}" -H 'Content-Type: application/json' \
    -d '{"name":"workspace","slug":"workspace"}' "http://localhost:${API_PORT:-8788}/knowledge-spaces"
  ```

  Publish readiness stays empty ("No document selected") until a document is uploaded through the Upload intake panel.
- Dense-vector indexing/search is disabled until `KNOWLEDGE_EMBEDDING_PROVIDER` is set to `openai`, `cohere`, `voyage`, or `static`. Set `KNOWLEDGE_EMBEDDING_MODEL` when you need a non-default model.
- For OpenAI-compatible embeddings, prefer `OPENAI_EMBEDDING_BASE_URL`; `OPENAI_BASE_URL` is accepted as a fallback and a trailing `/v1` is normalized before the embedding client appends `/v1/embeddings`.
- The API production image bundles the TypeScript compute package, so containerized ingestion can create KnowledgeNodes without an external runtime artifact.
- R2-compatible runtime wiring is available through `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and optional `R2_REGION`.
- The API and Admin containers run from standalone local images. Use `infra/local/compose.middleware.yaml` when you want middleware containers only and API/Admin from the host source tree.
- Build the API image directly with `pnpm docker:api:build` and the Admin image with `pnpm docker:admin:build` when you want to validate Dockerfiles outside Compose.
- The Unstructured API image follows the upstream self-hosted API image path.
- The live MinIO smoke test is intentionally separate from `pnpm check` so normal CI does not require long-running local containers.
- Run `pnpm docker:api:bundle-smoke` to start the built API image under `NODE_ENV=test` and verify `/health` reports `components.compute === true`. This isolated bundle check does not validate production fail-closed configuration or durable dependencies. `pnpm docker:api:http-smoke` is retained only as a compatibility alias.
- Run `pnpm docker:admin:http-smoke` after `pnpm docker:admin:build` to start the production Admin image and verify the Next.js standalone homepage renders.
- Run `pnpm docker:apps:smoke` to build both app images, run the isolated API bundle check, and run the Admin image homepage check. Validate production API wiring through the Compose-backed durable happy path and tenant-scoped upload/query checks.
