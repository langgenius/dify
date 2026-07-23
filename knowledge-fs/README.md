# KnowledgeFS

KnowledgeFS is Dify's backend knowledge runtime. It provides tenant-scoped ingestion, parsing,
indexing, retrieval, KnowledgeFS commands, MCP tools, durable jobs, traces, and evaluation APIs.

KnowledgeFS is not an independently deployable product. It must run with the Dify API:

- Dify owns model and datasource plugin credentials.
- Dify creates model and datasource plugin instances and performs plugin invocation.
- Dify owns physical object storage through its configured `STORAGE_TYPE`.
- KnowledgeFS reaches those capabilities only through the authenticated Dify inner API.
- `KNOWLEDGE_INTEGRATED_MODE_ENABLED` is a Workspace rollout/cutover gate; it never selects a
  different runtime or credential owner.

## Runtime architecture

```text
Dify API
  ├─ model manager / plugin daemon
  ├─ datasource plugins
  ├─ unified object storage
  └─ authenticated inner API
          │
          ▼
KnowledgeFS API
  ├─ document compilation and retrieval
  ├─ KnowledgeFS / MCP command surfaces
  ├─ PostgreSQL repositories and durable jobs
  └─ optional Unstructured parser dependency
```

Main directories:

```text
apps/api/                              KnowledgeFS backend entrypoint
packages/api/                          Hono gateway, repositories, retrieval, jobs, auth
packages/adapters/                     Database, Dify storage, cache, and queue adapters
packages/dify-model-runtime-client/    Bounded Dify model inner-API client
packages/dify-datasource-runtime-client/
                                       Bounded Dify datasource inner-API client
packages/core/                         Shared contracts and schemas
packages/database/                     Schema catalog and SQL migrations
packages/compute/                      Bounded pure TypeScript compute
packages/parsers/                      Native and Unstructured parser adapters
infra/local/                           Developer harness; requires a running Dify API
infra/kubernetes/                      Inert Dify integration baseline
```

The repository still contains reusable lower-level adapters and an optional local Admin test
harness. They are development assets, not alternative production deployment modes.

## Required production configuration

The canonical Dify Compose service loads
`docker/envs/core-services/knowledge-fs.env.example`. Operator-owned inputs are limited to:

- `DATABASE_URL`
- `DIFY_INNER_API_URL` and `DIFY_INNER_API_KEY`, injected by Dify Compose
- `UNSTRUCTURED_API_URL` and optional `UNSTRUCTURED_API_KEY`
- KnowledgeFS capability/JWKS and document-compilation rollout settings

Do not configure storage-provider credentials, model-provider keys, datasource credentials, or a
direct Plugin Daemon endpoint in KnowledgeFS. The Dify inner key must match
`INNER_API_KEY_FOR_PLUGIN`.

See [production deployment](docs/production-deployment.md) and the
[operator manual](docs/operator-manual.md).

## Development

Prerequisites:

- Node.js 22+
- pnpm 10.33.0 through Corepack
- Docker
- A reachable Dify API

Install dependencies:

```bash
corepack enable
pnpm install
cp infra/local/.env.example infra/local/.env
```

Set `DIFY_INNER_API_URL` and `DIFY_INNER_API_KEY` in the ignored local env, then start the local
database and parser:

```bash
pnpm dev:infra
pnpm local:db:migrate
```

Run the backend from source:

```bash
pnpm dev:api
```

For the optional local Admin test harness:

```bash
pnpm --filter @knowledge/admin dev
```

Run the bounded local smoke after Dify and the local processes are available:

```bash
pnpm local:happy-path
```

It validates health, workspace bootstrap, Markdown upload, parse artifacts, and query evidence.
Use `LOCAL_SMOKE_ADMIN_BASE` when the Admin harness is not on its default port. Other useful forms:

```bash
LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path
pnpm local:happy-path:durable
pnpm local:happy-path:api
```

The durable smoke requires database health and Dify-backed object-storage health. The API-only
smoke skips the Admin BFF.

See [the local developer guide](infra/local/README.md) for details.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm lint:backend
pnpm openapi:export:test
pnpm db:migrations:check
pnpm compose:middleware:test
pnpm compose:apps:test
pnpm dify:compose:config
git diff --check
```

Build the backend production bundle or image:

```bash
pnpm --filter @knowledge/api-app build:prod
pnpm docker:api:build
pnpm docker:api:bundle-smoke
```

The isolated image smoke proves the bundle can boot and remains unhealthy while Dify is absent; a
Dify Compose/Kubernetes smoke is required to validate the real inner API, storage, database,
models, and datasources.

## API and design references

- [API reference](docs/api-reference.md)
- [Production deployment](docs/production-deployment.md)
- [Operator manual](docs/operator-manual.md)
- [Project overview](docs/project-overview.md)
- [Kubernetes Dify integration baseline](infra/kubernetes/README.md)
- [OpenAPI snapshot](openapi/knowledge-fs.openapi.json)
