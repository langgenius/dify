# Local Development Environment

KnowledgeFS has no standalone deployment mode. This directory is a developer harness for running
the KnowledgeFS backend against an existing Dify API. Dify remains the owner of object storage,
model/plugin credentials, and datasource invocation.

## Prerequisites

- A running Dify API reachable through `DIFY_INNER_API_URL`.
- The matching Dify inner API key in `DIFY_INNER_API_KEY`.
- Docker for the local PostgreSQL and Unstructured dependencies.
- Poppler (`pdftoppm`) when processing PDFs with `pnpm dev:api`; the API container already includes it.

Copy `infra/local/.env.example` to the ignored `infra/local/.env` and set the Dify URL and key.
Do not add MinIO, cloud-storage credentials, model-provider keys, or datasource credentials to the
KnowledgeFS environment.

## Local dependencies

```bash
pnpm dev:infra
```

This starts:

- PostgreSQL with pgvector on port `5432`.
- A digest-pinned Unstructured API on port `8000`, capped at four CPUs and 6 GiB.

The local parser enables bounded PDF page parallelism and serves every remote document format.
KnowledgeFS applies a generic client budget of two concurrent requests and 600 seconds to ordinary
documents. Every PDF plus structurally or byte-heavy Office, mail, EPUB, ODT, and RTF input uses the
nested one-request gate and 2,400-second timeout. A source-run API uses
`UNSTRUCTURED_API_URL=http://127.0.0.1:8000`, while the containerized API uses
`UNSTRUCTURED_CONTAINER_API_URL=http://unstructured:8000`. This distinction avoids resolving
`127.0.0.1` inside the API container.

The `vector` extension is enabled automatically on a fresh PostgreSQL volume through
`infra/local/postgres-init/01-enable-pgvector.sql`.

Apply migrations explicitly after PostgreSQL starts:

```bash
pnpm local:db:migrate
```

If the PostgreSQL volume predates the init script, enable the extension once:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml exec postgres \
  psql -U "${POSTGRES_USER:-knowledge_fs}" -d "${POSTGRES_DB:-knowledge_fs}" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

## Source-run workflow

Keep `pnpm dev:infra` and the Dify API running, then start these commands in separate terminals:

```bash
pnpm local:db:migrate
pnpm dev:api
pnpm --filter @knowledge/admin dev
pnpm local:happy-path
```

`pnpm dev:api` automatically loads `infra/local/.env`. `pnpm local:happy-path` checks health,
workspace bootstrap, Markdown upload, parse-artifact reads, and bounded query evidence. Configure
`LOCAL_SMOKE_ADMIN_BASE` if the local Admin development server is not on
`http://127.0.0.1:3000`.

Useful variants:

```bash
LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path
pnpm local:happy-path:durable
pnpm local:happy-path:api
```

The durable variant requires `DATABASE_URL`, `DIFY_INNER_API_URL`, and `DIFY_INNER_API_KEY`, then
requires both database and Dify-backed object-storage health to pass. The API-only variant skips
the local Admin BFF.

## Containerized developer harness

The `apps` profile can build the backend and optional local Admin harness while still depending on
the external Dify API:

```bash
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps up -d --build
```

Default local endpoints:

- Admin developer harness: `http://localhost:3000`
- KnowledgeFS API health: `http://localhost:8788/health`
- KnowledgeFS API readiness: `http://localhost:8788/ready`
- Unstructured API: `http://localhost:8000`

The app-profile API enables its bundled Poppler rasterizer with the same bounded defaults as the
production image, including at most two concurrent Poppler page batches. Set
`KNOWLEDGE_PDF_RASTERIZER=off` in the ignored `infra/local/.env` to disable
it, or install Poppler on the host before using the source-run API for PDFs.

Remote parsing has a process-wide concurrency ceiling of two and a nested heavy-document ceiling
of one. Every PDF is heavy; Office, mail, ODT/RTF, and EPUB inputs enter the heavy policy only when
their bytes or bounded container metadata indicate substantial work. Ordinary requests keep a
600-second deadline, heavy requests use 2,400 seconds, and the 15 MiB parser input cap matches the
default product upload limit.

After parsing, canonical artifacts stay live through outline, semantic, graph, and index work. The
local defaults admit at most four such artifacts with a conservative aggregate retained-heap charge
of 128 MiB. An artifact that reaches that budget runs alone; queued cancellation does not enter the
downstream stages. Override `KNOWLEDGE_DOCUMENT_RETAINED_ARTIFACT_MAX_CONCURRENCY` and
`KNOWLEDGE_DOCUMENT_RETAINED_ARTIFACT_MAX_BYTES` together only after measuring the API container.

This Compose file is not a supported KnowledgeFS deployment topology. Production KnowledgeFS must
be started by Dify's Compose or Kubernetes deployment so the internal URL, authentication, storage,
models, datasources, and lifecycle are wired together.

## Validation

```bash
pnpm compose:config
pnpm compose:middleware:config
pnpm compose:middleware:test
pnpm compose:apps:test
```

The middleware Compose contains only PostgreSQL and Unstructured. The app-profile checks also
assert that no MinIO, cloud-storage credential, provider credential, or direct Plugin Daemon
configuration reaches the KnowledgeFS API. Both Compose files pin the same tested multi-platform
Unstructured image digest and enforce the same four-CPU/6-GiB parser ceiling.
