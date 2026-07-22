# KnowledgeFS

KnowledgeFS is a TypeScript knowledge platform for retrieval-augmented systems. It combines a Hono Knowledge Gateway, a Next.js Admin Console, portable platform adapters, and bounded in-process compute primitives.

The project is intentionally built around two deployment targets:

- SaaS target: Cloudflare Workers, R2, KV, and TiDB Cloud.
- Standalone target: Docker, Node.js, MinIO, Redis or in-memory cache, PostgreSQL with pgvector and full-text search.

The `.harness` directory is the project information base. It contains the architecture notes, iteration plan, agent development rules, temporary task/progress documents, and change records.

## Current Capabilities

- Hono API boundary with OpenAPI generation.
- Auth subject middleware for tenant-scoped business routes.
- KnowledgeSpace CRUD with in-memory and database-backed repository contracts.
- Document upload, object storage persistence, synchronous MVP parsing, parse artifact persistence, and read APIs.
- Native Markdown and HTML parsers plus Unstructured API client skeleton.
- Deterministic KnowledgeNode chunking through the shared TypeScript compute runtime.
- Dense vector and full-text projection contracts.
- Hybrid retrieval, reranking integration, metadata and permission filtering, EvidenceBundle assembly, and AnswerTrace recording.
- LLM provider abstraction, evidence-driven prompt packing, SSE streaming generation, citation normalization, generation cache, and skip path.
- KnowledgeFS path/resource model with `ls`, `tree`, `cat`, `stat`, `grep`, `find`, `diff`, and `open_node` command surfaces.
- MCP server skeleton and KnowledgeFS/retrieval/safe-shell tools.
- Rate limiting, degradation flags, component health reporting, and CI retrieval regression gate with recall, citation, faithfulness, and no-answer thresholds.
- Next.js Admin Console with upload health, retrieval preview, trace viewer, evaluation dashboard, Retrieval Studio, trace comparison, human annotation, and failed query diagnostics surfaces.

## Architecture

```text
apps/
  api/          Node standalone entrypoint for the Hono Knowledge Gateway
  admin/        Next.js Admin Console and thin UI BFF

packages/
  adapters/     Platform adapters for database, object storage, cache, and jobs
  api/          Hono gateway, repositories, retrieval, KnowledgeFS, MCP, auth, traces
  compute/      Bounded TypeScript compute: chunking, token counting, RRF, packing, diff
  core/         Shared schemas, platform contracts, command registry models
  database/     Schema catalog and checked-in SQL migration artifacts
  dify-model-runtime-client/
                Bounded Dify inner-API client for tenant model catalog and invocation
  embeddings/   Embedding and reranker providers plus version-aware cache wrappers
  generation/   LLM providers, prompt packing, generation cache, streaming helpers
  parsers/      Parser contracts, native parsers, Unstructured client, router

infra/
  local/          Local Docker Compose stack: compose files, .env.example, pgvector init, services guide
  aws_terraform/  Target AWS Standalone architecture (EC2 + Aurora Serverless v2 + S3); diagram only, no Terraform yet
```

TypeScript owns orchestration, IO, HTTP, MCP, database access, storage, cache, jobs, provider adapters, Admin UI, and all bounded compute primitives.

## Infrastructure

The `infra/` directory holds everything needed to *run* KnowledgeFS, organized by deployment target:

- **`infra/local/`** — the local Docker Compose stack used for development and CI. It contains `compose.yaml` (full stack: PostgreSQL + pgvector, MinIO, Unstructured, plus the API/Admin app containers behind the `apps` profile), `compose.middleware.yaml` (middleware only: Postgres, MinIO, bucket bootstrap, Unstructured), `.env.example` (copy to `infra/local/.env`), `postgres-init/01-enable-pgvector.sql` (auto-enables the `vector` extension on a fresh data volume), and a [services guide](infra/local/README.md). The `pnpm dev:*`, `compose:*`, and `local:db:migrate` scripts all target these files.
- **`infra/aws_terraform/`** — the target **AWS Standalone** deployment: a single EC2 host running the `api` + `unstructured` containers, Aurora Serverless v2 PostgreSQL + pgvector, and AWS S3 for object storage (the API authenticates to S3 via an EC2 IAM instance role). Currently the [target architecture diagram and component/env mapping](infra/aws_terraform/README.md) only — the Terraform modules and deployment runbook are not written yet.

## Prerequisites

- Node.js 22 or newer.
- pnpm 10.33.0 through Corepack.
- Docker Desktop or compatible Docker Compose runtime.

Recommended setup:

```bash
corepack enable
pnpm install
```

## Environment

Copy local Compose defaults before running infrastructure:

```bash
cp infra/local/.env.example infra/local/.env
```

Important local variables:

- `API_PORT`: Hono API port, default `8788` for local source and host access. The API container still listens on `8787` internally.
- `ADMIN_PORT`: Admin Console port, default `3000`.
- `POSTGRES_*`: local PostgreSQL credentials and port.
- `DATABASE_URL`: optional source-run PostgreSQL connection string. When set, the Node adapter uses a pool-backed PostgreSQL executor and the API app uses database-backed core repositories.
- `KNOWLEDGE_DATABASE_REPOSITORIES`: set to `off`, `false`, or `0` to keep bounded memory repositories even when `DATABASE_URL` is present.
- Durable deletion is deliberately deployment-gated. Set `DURABLE_DELETION_ENABLED=true` only
  after every running writer understands migration `0017` tombstones, and declare
  `DURABLE_DELETION_WRITER_FENCE_VERSION=0017`. A stable, canonical base64 key of at least 32 bytes
  is then required in `DURABLE_DELETION_HMAC_KEY_BASE64`. Keep that key unchanged while deletion
  jobs or idempotency ledgers are retained; silent rotation makes old request fingerprints
  unverifiable. With the gate off, destructive routes remain unavailable.
- `MINIO_*`: local MinIO credentials, bucket, API port, and console port.
- `UNSTRUCTURED_PORT`: local Unstructured API port.
- `UNSTRUCTURED_API_URL`: Unstructured base URL or full partition endpoint used by the source-run API for PDF, Word, PowerPoint, and other complex document parsing.
- `DIFY_INNER_API_URL`, `DIFY_INNER_API_KEY`: Dify API inner boundary used for embedding,
  rerank, LLM, multimodal embedding, model catalog, and datasource calls in integrated mode. The
  key must match Dify's `INNER_API_KEY_FOR_PLUGIN`. KnowledgeFS sends model routing identity or a
  datasource `credentialId`; Dify resolves credential bytes and invokes plugin-daemon.
- `PLUGIN_DAEMON_URL`, `PLUGIN_DAEMON_KEY`: legacy direct datasource transport used only by the
  standalone profile (`KNOWLEDGE_INTEGRATED_MODE_ENABLED` is not `true`).
- `R2_*`: optional Cloudflare R2-compatible storage configuration.

Without database or object-storage runtime configuration, local gateway paths use bounded in-memory fallbacks. With `DATABASE_URL` set, the Node adapter executes parameterized PostgreSQL queries and the API app persists core workspace, document, artifact, node, and projection records through database-backed repositories. With MinIO variables present, it can use S3-compatible object storage.

## Local Development

Install dependencies:

```bash
pnpm install
```

Start infrastructure only:

```bash
pnpm dev:infra
```

This uses `infra/local/compose.middleware.yaml` and starts only PostgreSQL, MinIO, a one-shot MinIO bucket bootstrap service, and Unstructured. It does not start the API or Admin containers, so you can run `apps/api` and `apps/admin` from your local source tree.

Apply PostgreSQL migrations when using `DATABASE_URL` with the source-run API:

```bash
pnpm local:db:migrate
```

Start the full local Compose stack:

```bash
pnpm dev:stack
```

This starts infrastructure plus the API and production Admin app containers. The local API explicitly runs with
`NODE_ENV=development` so its static token verifier cannot be confused with a production verifier. The API listens
on `http://localhost:8788` by default; the Admin Console listens on `http://localhost:3000`.

Run the API directly from the workspace:

```bash
pnpm dev:api
```

The source API dev script loads `infra/local/.env` automatically, so `DATABASE_URL`, MinIO, and local auth settings match the migration command.
If you already have a local `infra/local/.env`, make sure `API_PORT`,
`KNOWLEDGE_API_BASE_URL`, and `NEXT_PUBLIC_API_BASE_URL` point at the same
host-visible API port.

If the Admin Console reports every health card as unavailable, or upload fails
with `Knowledge API upload route was not found`, first confirm that the API base
points at the KnowledgeFS API and not another local service:

```bash
curl http://localhost:${API_PORT:-8788}/health
```

The response should be a KnowledgeFS health payload with `runtime` and
`components`. If another service answers on that port, run the API on a free port
and point the Admin BFF at the same base:

```bash
API_PORT=8790 pnpm dev:api
KNOWLEDGE_API_BASE_URL=http://localhost:8790 NEXT_PUBLIC_API_BASE_URL=http://localhost:8790 PORT=3000 pnpm --filter @knowledge/admin dev
```

Run the Admin Console directly:

```bash
pnpm --filter @knowledge/admin dev
```

The Admin dev server should use values from `infra/local/.env`. Restart it after changing `KNOWLEDGE_API_BASE_URL` or `NEXT_PUBLIC_API_BASE_URL`;
Next keeps those values from process startup.

Browse the gateway's OpenAPI document in Swagger UI:

```bash
pnpm dev:api   # gateway must be running (local source default :8788)
pnpm swagger   # serves Swagger UI on http://localhost:8088
```

`pnpm swagger` runs a small dependency-free Node reverse proxy (`tools/swagger/`)
that serves a Swagger UI shell and forwards `/openapi.json` and "Try it out"
requests to the gateway from the same origin, which avoids the gateway's lack of
CORS headers. It targets `http://localhost:8788` by default; override the target
or port with `KFS_API` and `KFS_SWAGGER_PORT`. See
[`tools/swagger/README.md`](tools/swagger/README.md) for details.

Run the local source happy-path smoke from another terminal after `pnpm dev:infra`,
`pnpm dev:api`, and the Admin dev server are available:

```bash
pnpm local:happy-path
```

The smoke validates the middleware Compose config, builds the Admin app, checks API
health, checks Admin BFF health, bootstraps the `workspace` KnowledgeSpace if
needed, uploads a Markdown document through the Admin BFF proxy, reads the
`DocumentAsset`, reads parse artifact version 1, and runs a bounded query evidence
check against the uploaded content without manual database edits. To
point the smoke at a non-default Admin server, set `LOCAL_SMOKE_ADMIN_BASE`.
To skip the Admin build during rapid local iteration, run
`LOCAL_SMOKE_SKIP_ADMIN_BUILD=1 pnpm local:happy-path`.
To include the checked-in PostgreSQL migrations in the same smoke run, run
`LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path`.
To require the durable local setup explicitly, run `pnpm local:happy-path:durable`.
That command applies migrations, requires `DATABASE_URL` plus MinIO env, and fails if
database or object storage health is not green.
To validate only the API source process without requiring the Admin dev server, run
`pnpm local:happy-path:api`.

## Admin Console Guide

The Admin Console at `http://localhost:3000` is both an operator console and a
retrieval quality workbench. Most sidebar entries jump to panels on the main
page; `Documents` opens a dedicated document list for the selected
KnowledgeSpace.

Use `System health` first when the console looks empty or unavailable. It shows
whether the Admin app can reach the Knowledge Gateway and whether API components
are healthy. If all cards are unavailable, verify `KNOWLEDGE_API_BASE_URL`,
`NEXT_PUBLIC_API_BASE_URL`, the Admin token, and the API `/health` response.

Use `Control plane` to inspect the selected KnowledgeSpace's bounded operational
state: manifest version, storage provider, object key prefix, parser policy,
projection set, document count, raw document bytes, and active sessions. This is
the first place to check when a space appears to use the wrong storage, parser,
or projection version.

Use `FSCK` for read-only consistency diagnostics. The panel runs a bounded dry
run and summarizes scanned items, errors, warnings, repairable issues, and the
first page of findings. It is useful when uploaded documents, raw objects,
parse artifacts, paths, or references appear out of sync.

Use `GC` to review staged-object cleanup candidates. The panel starts with a
dry run and shows candidate type, reason, estimated bytes, and dry-run id. Only
execute `Delete candidate` for candidates returned by the dry run and after
confirming the failed staged commit or abandoned object no longer needs recovery.

Use `Upload intake` to upload a single document into a KnowledgeSpace. Choose the
space, optionally provide a `sourceId`, choose a Markdown, HTML, PDF, Word,
PowerPoint, or text file, then submit `Upload document`. After upload, use the
result links or `Documents` to inspect the document status and parse artifact.

Use `Retrieval workspace` to run a live query. Enter a question, select `fast`,
`deep`, or `research`, then submit `Run query`. The response shows the generated
answer, inline citations, confidence, freshness, and trace id. That trace id
feeds the retrieval, trace review, failed diagnostics, and comparison panels.

Use `KnowledgeFS` to browse the virtual filesystem. Enter a path such as
`/knowledge/by-topic`, `/knowledge/by-entity`, `/knowledge/by-community`, or
`/knowledge/by-type`, then submit `Browse path`. This view shows how published
knowledge is organized for human, API, and agent reads.

Use `Documents` to open the document asset list for the active KnowledgeSpace.
The list reads the document asset API directly, so it does not depend on a
KnowledgeFS path view being published. Open a document to view parser status,
object key, size, version, and the parse artifact for version 1.

Use `Entity browser` to inspect graph relationships around one entity. Enter an
entity id and submit `Traverse graph`. The panel shows related entities,
relation edges, traversal depth, fanout, and confidence. It is useful for
debugging entity extraction and graph-expanded retrieval.

Use `Semantic views` to inspect live topic, entity, and community views exposed
through KnowledgeFS. The topic view maps to `/knowledge/by-topic`; the entity
view maps to `/knowledge/by-entity`; and the community view maps to
`/knowledge/by-community`. The Admin panel renders these as topic groups,
readable entities, and knowledge communities with short summaries instead of raw
graph ids. When LLM semantic extraction is configured, upload/compilation runs
entity extraction, relation extraction, graph indexing, community
materialization, and community summary generation as one post-processing flow.
Community materialization uses explicit graph relations when available, falls
back to entity co-occurrence only for disconnected extracted entities, links the
source documents under each community, and stores an LLM summary on the
community path.

Topic entries appear after topic-view materialization. Entity and community
entries can be populated automatically during synchronous compute-backed
ingestion or durable compilation workers when semantic entity extraction is
configured; otherwise click `Extract entities` to backfill extracted node
entities and refresh `/knowledge/by-entity`, then click
`Materialize communities` to publish `/knowledge/by-community`. If the panel
says `Not materialized`, click `Materialize topic view` to publish uploaded
documents under `/knowledge/by-topic/uploaded-documents`. In the Node API app
entity and relation extraction use LLM-backed extraction when
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is configured; set
`KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER=openai|anthropic` and
`KNOWLEDGE_ENTITY_EXTRACTION_MODEL` to pin the provider/model, and
`KNOWLEDGE_ENTITY_EXTRACTION_MAX_NODES_PER_RUN` to bound each extraction pass.
Set `KNOWLEDGE_RELATION_EXTRACTION_MODEL` or `KNOWLEDGE_COMMUNITY_SUMMARY_MODEL`
when relation extraction or community summaries should use a different model.
Without an LLM provider, semantic extraction is disabled instead of falling back
to noisy regex extraction. Use `Documents` and `KnowledgeFS` to inspect uploaded
content before or after these operator actions.

Use `Document diff` to compare two KnowledgeFS paths. Provide an old path and a
new path, then submit `Run diff`. The panel shows text-level differences and,
when the semantic diff provider is configured, citation-ready semantic change
summaries.

Use `Golden questions` to manage the evaluation set. Create questions with
expected evidence ids and tags, update or delete existing questions by id, and
record human annotations for answer correctness and evidence relevance. This
data drives regression evaluation and bad-case review.

Use `Evaluation dashboard` to monitor quality review progress. It summarizes
the golden question count, annotated items, production bad cases, and pending
queue. Use `Production bad-case capture` with a trace id, reason, and tags to
turn a real failed answer into an evaluation item.

Use `Retrieval Studio` after running a query. It shows the latest trace id,
query mode, query text, and evidence entries used by the retrieval pipeline. It
is the quickest way to inspect which evidence supported an answer.

Use `Trace comparison` to compare two query traces side by side. Run one query
or provide a current `traceId`, enter another trace id in `Compare trace ID`,
then submit `Compare traces`. This is useful when comparing retrieval strategy,
parser, projection, or prompt changes.

Use `Failed diagnostics` after a query produces a poor result. The panel shows
candidate ranking plus missing or conflicting evidence entries when available.
Use it to determine whether the issue came from recall, filtering, ranking,
conflicting evidence, or missing evidence.

Use `Trace review` to inspect the step-by-step execution path for a query trace:
recall, reranking, evidence selection, generation, and any skipped or failed
steps. This is the most detailed view for debugging one answer.

The usual local workflow is: check `System health` and `Control plane`, upload a
document through `Upload intake`, confirm it in `Documents`, browse organization
through `KnowledgeFS` or `Semantic views`, run a query in `Retrieval workspace`,
inspect evidence in `Retrieval Studio` and `Trace review`, then capture bad
answers into `Golden questions` and the `Evaluation dashboard`.

Validate the middleware-only Compose file:

```bash
pnpm compose:middleware:config
pnpm compose:middleware:test
```

Validate the full app profile contract without starting services:

```bash
pnpm compose:apps:test
```

Validate Compose configuration without starting services:

```bash
pnpm compose:config
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
```

## Verification

The main local gate is:

```bash
pnpm check
```

It runs:

- TypeScript typechecking.
- Unit tests.
- Coverage gates.
- Retrieval regression evaluation.
- Database migration drift check.

Additional full verification used before implementation commits:

```bash
pnpm build
pnpm lint
pnpm compose:apps:test
pnpm compose:config
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
pnpm docker:api:build
pnpm docker:api:bundle-smoke
git diff --check
```

Run the live MinIO smoke separately when local containers are available:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml up -d minio minio-bootstrap
pnpm test:minio
```

The live MinIO smoke is intentionally not part of `pnpm check` so CI and daily development do not require long-running containers.

## Database Migrations

The schema catalog in `packages/database` is the source for generated SQL artifacts.

Generate checked-in migration artifacts:

```bash
pnpm db:migrations:write
```

Check for drift:

```bash
pnpm db:migrations:check
```

Generated migrations live in `packages/database/migrations` and currently include PostgreSQL and TiDB initial schema artifacts.

## TypeScript Compute

Bounded pure compute lives in `packages/compute`. It provides deterministic document chunking,
approximate token counting, reciprocal-rank fusion, evidence packing, and line/word text diff.
The API imports this package directly; there is no generated runtime artifact or separate build
step.

Build the production app images directly:

```bash
pnpm docker:api:build
pnpm docker:admin:build
```

Run `pnpm docker:api:bundle-smoke` to start the built API image in an isolated
`NODE_ENV=test` process and verify that the standalone Hono bundle responds on `/health` with
`components.compute === true`. This is a bundle/startup check only: it does not validate
production fail-closed configuration, database repositories, durable compilation, object storage,
or external providers. `pnpm docker:api:http-smoke` remains a compatibility alias for this isolated
check.
Run `pnpm docker:admin:http-smoke` to start the production Admin image and verify
the Next.js standalone homepage renders.
Run `pnpm docker:apps:smoke` when you want one command to build both app images, run the isolated
API bundle check, and run the Admin image homepage check. Use a deployed or Compose-backed health,
upload, and query flow to validate production runtime configuration.

## API And Auth Notes

- `/health` and `/openapi.json` are public.
- Business routes are protected by Bearer-token auth.
- Auth subject data is server-derived and includes `subjectId`, `tenantId`, and `scopes`.
- KnowledgeSpace, document, parse artifact, retrieval, and KnowledgeFS operations are tenant scoped.
- Cross-tenant resource access returns not found semantics where appropriate.

Read scopes:

- `knowledge-spaces:read`
- `knowledge-spaces:*`

Write scopes:

- `knowledge-spaces:write`
- `knowledge-spaces:*`

## Performance And Safety Rules

Project development treats performance bugs as correctness bugs. In particular:

- No unbounded list, dequeue, file read, stream read, or cache entry.
- No N+1 database access on hot paths.
- All database reads require explicit row limits.
- Tenant and permission dimensions must be part of data access and cache boundaries.
- Cache keys must include model, strategy, permission, and index versions where relevant.
- User input must be parameterized in SQL and never interpolated into query strings.
- Object and cache values must use clone/copy semantics to avoid internal state leaks.
- Streaming and provider responses must be bounded by byte limits.

## CI

GitHub Actions runs on pushes to `main` and pull requests. The workflow performs:

- Dependency install with frozen lockfile.
- `pnpm check`.
- Explicit retrieval regression evaluation.
- Build.
- Lint.
- Compose config validation.
- TypeScript compute tests and coverage gates.

The retrieval regression gate uses `.harness/evaluation/retrieval-regression-report.json` and fails on severe recall, citation-hit, citation-accuracy, faithfulness, no-answer, baseline-delta, or sample-size regressions.

## Workflow Runtime Boundary

KnowledgeFS currently runs durable work through `JobQueueAdapter` implementations and explicit TypeScript state machines. The future Temporal-compatible boundary is documented in [docs/temporal-compatible-interface.md](docs/temporal-compatible-interface.md); it defines how document compilation, retention cleanup, bulk operations, and model upgrade workflows can later move to Temporal without leaking Temporal SDK concepts into API routes or repositories.

## Documentation

- [API Reference](docs/api-reference.md): route map, auth/scopes, error semantics, ingestion, query, evaluation, KnowledgeFS, job, retention, and snapshot endpoints.
- [Production deployment guide](docs/production-deployment.md): SaaS and Standalone deployment shape, environment variables, release gates, smoke checks, rollback, and current production wiring gaps.
- [Operator Manual](docs/operator-manual.md): daily health checks, release checklist, ingestion/retrieval/evaluation operations, incident response, rollback, observability, and performance guardrails.
- [Local infrastructure guide](infra/local/README.md): Docker Compose services, pgvector init, and MinIO bucket bootstrap.
- [AWS Terraform plan](infra/aws_terraform/README.md): target AWS Standalone architecture diagram and component/env mapping (Terraform code pending).

## Development Workflow

The active project workflow is documented in `.harness/agents/development-requirements.md` and `.harness/docs/TEMP-task-document.md`.

Core rules:

- Follow test-driven development for behavior changes.
- Keep coverage at or above 90%.
- Record every implementation slice under `.harness/changes`.
- Update `.harness/docs/TEMP-progress-document.md` as work completes.
- Commit and push after each verified implementation slice.
- After every 10 implementation commits from the latest review checkpoint, pause feature work and review project health.

## Useful Commands

```bash
pnpm install
pnpm check
pnpm build
pnpm lint
pnpm dev:infra
pnpm dev:stack
pnpm compose:config
pnpm db:migrations:write
pnpm db:migrations:check
```

## Project Status

This repository is under active iterative development. The latest authoritative status is in:

- `.harness/docs/iteration-plan.md`
- `.harness/docs/TEMP-task-document.md`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/`
