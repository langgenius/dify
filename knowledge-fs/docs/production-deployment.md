# Production Deployment Guide

This guide covers the two supported production shapes for KnowledgeFS:

- **SaaS:** Cloudflare Pages for the Next.js Admin Console, Cloudflare Workers for the Hono Knowledge Gateway, R2 for object storage, KV for cache/session state, TiDB Cloud for relational search/index data, and Unstructured API for complex document parsing.
- **Standalone:** Docker Compose or equivalent orchestration with a separate Admin service, Hono API service, PostgreSQL + pgvector, MinIO, Redis or bounded in-memory cache, and Unstructured API.

The deployment boundary is intentional: Next.js owns only the human Admin Console and thin UI BFF routes, while Hono owns all platform APIs, retrieval, ingestion, KnowledgeFS, MCP, auth, provider orchestration, and persistence.

Related operating documents:

- [API reference](api-reference.md) for route, scope, and error semantics.
- [Operator manual](operator-manual.md) for daily checks, release process, incident response, rollback, observability, and performance guardrails.

## Release Gates

Run the full verification set before promoting a release candidate:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm lint
pnpm compose:config
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
pnpm docker:api:build
pnpm docker:api:bundle-smoke
git diff --check
```

`docker:api:bundle-smoke` is an isolated image-bundle gate. It overrides the container to
`NODE_ENV=test`, checks `/health`, and requires `components.compute === true`. It does **not**
validate production fail-closed startup or the configured database, durable compilation, object
storage, parser, plugin-daemon, and model-provider dependencies. Treat the deployed SaaS or
Standalone smoke flows later in this guide as the production configuration gate.

Optional live storage smoke for Standalone object storage:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml up -d minio minio-bootstrap
pnpm test:minio
```

The bounded compute runtime is ordinary TypeScript bundled with the API; no generated runtime
artifact or language-specific toolchain is required during deployment.

## Runtime Configuration

Shared API settings:

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | Yes | Use `production` for deployed services. |
| `PORT` | Standalone API | Hono API port, default `8787` locally. |
| `AUTH_JWT_SECRET` | Production API | Shared secret for the current JWT verifier until OIDC/JWKS wiring is added. |
| `UNSTRUCTURED_API_URL` | Ingestion for complex files | Base URL for Unstructured API. |
| `UNSTRUCTURED_API_KEY` | SaaS or protected Unstructured | Optional API key sent by the parser client. |

Object storage:

| Target | Variables |
|---|---|
| MinIO / S3-compatible | `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, optional `MINIO_REGION` |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, optional `R2_REGION` |

Database and cache:

| Target | Variables |
|---|---|
| PostgreSQL standalone | `DATABASE_URL` pointing to PostgreSQL + pgvector. |
| TiDB Cloud SaaS | `DATABASE_URL` or future TiDB serverless binding once runtime driver wiring is introduced. |
| Cache/session state | Current runtime uses adapter-backed cache. Use KV/Redis wiring when available; otherwise bounded in-memory fallback is development-only. |

Durable document compilation is controlled by `KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME` and is off
by default. Setting it to `on`, `true`, or `1` assembles the database attempt/outbox control plane,
candidate-only worker/evaluator, publication coordinator, dispatcher, and runtime consumer. Startup
fails closed unless database repositories, the compute runtime, and the per-knowledge-space plugin
embedding resolver are all available; it never falls back to the legacy in-memory writer. The API
and compilation consumer currently run in the same process. The remaining bounded settings are
`KNOWLEDGE_DOCUMENT_COMPILATION_BATCH_SIZE`, `KNOWLEDGE_DOCUMENT_COMPILATION_LEASE_MS`,
`KNOWLEDGE_DOCUMENT_COMPILATION_MAX_ATTEMPTS`,
`KNOWLEDGE_DOCUMENT_COMPILATION_OUTBOX_VISIBILITY_MS`,
`KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_BASE_MS`,
`KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS`, and
`KNOWLEDGE_DOCUMENT_COMPILATION_TICK_MS`.

When database repositories are enabled, `KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME=on` is mandatory:
startup rejects the unsafe synchronous-upload combination because it can only create legacy
`NULL`-generation rows and no immutable publication head. `NODE_ENV=production` also rejects the
process-local repository fallback. Migration `0009_legacy_space_bootstrap` installs a fail-closed
ledger for every pre-cutover space. The runtime freezes a bounded document/version/SHA-256 set,
rebuilds one document generation at a time, verifies the final publication, ready flattened
PageIndex and FTS/Graph ownership closure, and only then opens query readiness. Intermediate child
heads are intentionally unavailable (queries return 503); upload, delete, reindex, and ordinary
compilation remain fenced (409) until completion. Operators can inspect/start/retry the tenant-
scoped ledger at `/knowledge-spaces/{id}/publication-bootstrap` and
`/knowledge-spaces/{id}/publication-bootstrap/retry`. Never delete or bypass a failed ledger.
Document writes also hold a durable, space-exclusive mutation lease across object and metadata
writes so snapshot capture cannot interleave after admission. These leases intentionally have no
automatic expiry: after a writer crash, prove the process has stopped and reconcile its staged
commit/object state before manually removing an orphan lease; time-based eviction is unsafe.

Admin Console:

| Variable | Required | Purpose |
|---|---:|---|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | Browser-visible URL for the Hono API. |

## SaaS Deployment

### 1. Provision services

Provision the SaaS backing services before deploying code:

1. Cloudflare R2 bucket for document objects.
2. Cloudflare KV namespace for cache/session state once KV runtime wiring is enabled.
3. TiDB Cloud database for relational tables, FTS-like indexes, retrieval metadata, traces, and generated artifacts.
4. Unstructured API endpoint for PDF/DOCX/PPTX and other complex formats.
5. Cloudflare Pages project for `apps/admin`.
6. Cloudflare Workers project for the Hono API runtime.

Run migration drift checks before applying any database migration:

```bash
pnpm db:migrations:check
```

The checked-in artifacts live in `packages/database/migrations`. Apply the TiDB artifact to the SaaS database only through the controlled database release process for the environment.

Migration `0017_durable_deletion` adds permanent writer tombstones and the checkpointed
Space/Source/Document deletion ledger. Deploy it in two phases. First, apply `0017` and roll out
the new API/worker build to every writer with `DURABLE_DELETION_ENABLED=off`. Verify that no older
writer remains. Only then set all of the following on the API deployment and restart it:

```bash
DURABLE_DELETION_ENABLED=true
DURABLE_DELETION_WRITER_FENCE_VERSION=0017
DURABLE_DELETION_HMAC_KEY_BASE64=<canonical-base64-of-at-least-32-random-bytes>
```

The HMAC key is part of the retained deletion/idempotency audit contract. Keep it stable for as
long as deletion jobs, retry audits, or idempotency ledgers are retained; do not silently rotate
it. Enabling deletion without the exact writer-fence declaration, database repositories, secret
cleanup capability, or a valid key fails startup. Leaving the gate off keeps destructive routes
unavailable while all read/write paths still honor any existing tombstones.

`0017` also adds nullable tenant/space ownership to historical `evidence_bundles`. The migration
backfills only bundles whose AnswerTrace/Research references agree on exactly one scope; ambiguous
rows stay quarantined with NULL ownership. Before enabling deletion, run the bounded maintenance
operation `purgeUnscopedEvidenceBundlesPage` until it returns zero, then retain this zero-result
audit with the release evidence:

```sql
SELECT COUNT(*) AS unscoped_evidence_bundles
FROM evidence_bundles
WHERE tenant_id IS NULL OR knowledge_space_id IS NULL;
```

Startup repeats this readiness check whenever durable deletion is enabled and fails closed if the
count is nonzero. Do not assign an ambiguous bundle to a guessed space; purge it and let scoped
writers recreate future evidence under the exact tenant/space boundary.

Migration `0005_publication_generation_nonzero` requires TiDB 7.2 or newer with
`tidb_enable_check_constraint` enabled. The migration runner verifies both conditions before it
executes the migration and fails closed when CHECK constraints would not be enforced. Configure
the database cluster accordingly before starting the release.

Migration `0006_document_compilation_attempts` additionally requires
TiDB 8.5 or newer, `@@GLOBAL.tidb_enable_foreign_key=ON`, and
`@@SESSION.foreign_key_checks=ON`. Version 8.5 is the first release where TiDB foreign keys are
generally available. The runner validates these conditions before DDL, rejects historical
Knowledge Space tenant IDs longer than 255 characters before narrowing the column, and checks
`SHOW CREATE TABLE` afterward so TiDB cannot silently retain `FOREIGN KEY INVALID` declarations.
Run migrations through this runner rather than executing the TiDB artifact in a session with
different constraint settings.

Migration `0012_tidb_baseline_repair` is a mandatory forward repair for TiDB environments. Before
the first supported production release, the clean-install TiDB artifacts `0001`, `0002`, `0004`,
`0006`, and `0007` were corrected in place to remove unsupported TEXT/JSON/expression/FULLTEXT key
definitions and CHECK/foreign-key combinations. An experimental environment may already have
recorded those migration IDs, so changing only the historical files cannot repair that database.
`0012` reapplies every material type, generated-column, index, CHECK, and compilation foreign-key
correction under a new immutable ID. Its PostgreSQL pair is an intentional no-op.

Take a schema snapshot and a normal database backup before applying `0012`. The migration performs
no destructive data cleanup: an overlong value, duplicate logical identity, or orphaned foreign-key
row aborts DDL and leaves `0012` unrecorded. Reconcile the reported data explicitly and rerun; do
not truncate values, delete an arbitrary duplicate, disable CHECK constraints, or turn off foreign
keys to force the release through. After the runner succeeds, retain these audit results with the
release evidence:

```sql
SELECT migration_id, dialect, applied_at
FROM schema_migrations
WHERE migration_id = '0012_tidb_baseline_repair' AND dialect = 'tidb';

SHOW CREATE TABLE index_projections;
SHOW CREATE TABLE knowledge_nodes;
SHOW CREATE TABLE document_compilation_attempts;
SHOW CREATE TABLE document_compilation_outbox;

SELECT table_name, column_name, column_type, extra, generation_expression
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND column_name IN ('model_key', 'publication_generation_key')
ORDER BY table_name, column_name;

SELECT table_name, index_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND (
    index_name = ''
    OR index_name IN (
      'resource_mounts_permission_scope_idx',
      'knowledge_nodes_permission_scope_idx',
      'index_projections_fts_document_idx',
      'graph_entities_permission_scope_idx',
      'graph_relations_permission_scope_idx'
    )
  );
```

The audit must show `model_key` and every `publication_generation_key` as virtual generated
columns; generated-column-backed identity indexes; no permission-scope JSON or `fts_document`
FULLTEXT index (the final audit query must return no rows); exactly the three named attempt foreign
keys and one named outbox foreign key from
`0012`; and none of
`document_compilation_attempts_document_version_ck`,
`document_compilation_attempts_candidate_pair_ck`, or
`document_compilation_attempts_candidate_checkpoint_ck`. The runner independently validates the
foreign-key names/count and rejects `FOREIGN KEY INVALID` after all pending migrations.

### 2. Build the Hono API for Workers

The repository currently has the portable Hono gateway and adapter contracts, but it does not yet commit a Workers-specific `wrangler.toml`. Use this guide as the required shape for that later runtime wiring:

```toml
name = "knowledge-fs-api"
main = "apps/api/src/worker.ts"
compatibility_date = "2026-05-11"

[[r2_buckets]]
binding = "DOCUMENT_OBJECTS"
bucket_name = "knowledge-fs-documents"

[[kv_namespaces]]
binding = "KNOWLEDGE_CACHE"
id = "<kv-namespace-id>"
```

Expected Worker secrets:

```bash
wrangler secret put AUTH_JWT_SECRET
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put DATABASE_URL
wrangler secret put UNSTRUCTURED_API_KEY
```

Deploy only after the Workers entrypoint exists and the release gates pass:

```bash
pnpm build
wrangler deploy
```

### 3. Deploy the Admin Console to Pages

The Admin Console must call the Hono API rather than importing platform internals.

Set Pages environment variables:

```text
NEXT_PUBLIC_API_BASE_URL=https://<api-worker-domain>
NODE_ENV=production
```

Build command:

```bash
pnpm install --frozen-lockfile
pnpm --filter @knowledge/admin build
```

Output mode is currently Next.js standalone-oriented. If deploying to Cloudflare Pages, add the Pages adapter in a dedicated slice and keep all core behavior behind the Hono API.

### 4. SaaS smoke checks

After deployment:

```bash
curl -fsS https://<api-worker-domain>/health
curl -fsS https://<api-worker-domain>/openapi.json
```

Then verify a tenant-scoped authenticated flow with a non-production test tenant:

1. Create a KnowledgeSpace.
2. Upload a Markdown or HTML document.
3. Confirm parse status becomes `parsed`.
4. Run a query and verify citations, trace id, and session id headers.
5. Confirm cross-tenant access returns 404 or 403 as appropriate.

## Standalone Deployment

### 1. Build images

The API image is already defined in `apps/api/Dockerfile`:

```bash
pnpm docker:api:build
```

The Admin service currently runs as a Compose development container. For production Standalone, build a separate Admin image from the Next.js standalone output or run the Next server in an equivalent process manager. Keep it as a separate service from the API.

### 2. Configure Compose

The local Compose file already models the production service separation:

- `api`: Hono API service.
- `admin`: Next.js Admin Console.
- `postgres`: PostgreSQL + pgvector.
- `minio`: S3-compatible object storage.
- `minio-bootstrap`: one-shot bucket creation.
- `unstructured`: self-hosted parser service.

Validate the resolved deployment plan:

```bash
docker compose --env-file infra/local/.env.example -f infra/local/compose.yaml --profile apps config
```

For a production environment, override local defaults with environment-specific secrets:

```text
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<database>
MINIO_ENDPOINT=http://minio:9000
MINIO_BUCKET=knowledge-fs
MINIO_ACCESS_KEY=<access-key>
MINIO_SECRET_KEY=<secret-key>
AUTH_JWT_SECRET=<strong-secret>
UNSTRUCTURED_API_URL=http://unstructured:8000
NEXT_PUBLIC_API_BASE_URL=https://<api-domain>
```

Do not commit environment files containing production secrets.

### 3. Apply database migrations

Check migration drift in CI and before deployment:

```bash
pnpm db:migrations:check
```

Apply every pending PostgreSQL artifact from `packages/database/migrations` in migration-id order
through the migration runner or the controlled deployment system. Do not apply only `0001` to an
existing environment. Re-run health and smoke checks after migrations complete.

### 4. Start services

For an environment using the repository Compose file:

```bash
docker compose --env-file infra/local/.env -f infra/local/compose.yaml --profile apps up -d
```

The API service depends on PostgreSQL health, Unstructured startup, and successful MinIO bucket bootstrap. If the bootstrap service fails, do not start the API against a missing object bucket.

### 5. Standalone smoke checks

```bash
curl -fsS http://localhost:8787/health
curl -fsS http://localhost:8787/openapi.json
```

Run the same tenant-scoped upload and query smoke used for SaaS. Also verify MinIO bucket contents and PostgreSQL row counts through operational tooling, not through ad hoc application-side scans.

## Rollback

Rollback order should preserve data integrity:

1. Stop traffic to Admin and API.
2. Roll back API first if the issue is ingestion, retrieval, auth, or persistence.
3. Roll back Admin first only for UI-only regressions.
4. Do not roll back database migrations without an explicit down-migration and data impact review.
5. Keep object storage data; do not bulk-delete uploaded objects during rollback.

## Operational Guardrails

- Keep API and Admin deploys separately observable, even when they are released together.
- Keep object reads, cache entries, query context, and streaming responses bounded.
- Use tenant id, subject id, permission snapshot, model version, and index version in cache keys where relevant.
- Never expose JWTs, raw file bytes, document text, or provider prompts in traces or logs.
- Treat missing database indexes and N+1 query paths as release blockers.
- Run retrieval regression gates before production promotion.

## Current Gaps

The current repository has production-ready contracts and local/CI gates, but these items still need dedicated implementation slices before fully automated production deploys:

- Commit Workers entrypoint and `wrangler.toml`.
- Add Cloudflare KV and TiDB runtime driver wiring.
- Add production Admin Dockerfile or Pages adapter configuration.
- Add secret-management automation for each environment.
- Add deployment pipeline jobs beyond validation gates.
