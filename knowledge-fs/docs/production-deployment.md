# KnowledgeFS Production Deployment

KnowledgeFS has one supported production topology: an internal backend service deployed as part of
Dify. It has no independent SaaS, private-cloud, or single-host deployment mode.

The existing Dify knowledge-base feature and KnowledgeFS intentionally coexist during rollout.
This deployment does not migrate, replace, or delete existing Dataset/Document data.

## Dependency ownership

| Capability | Owner | KnowledgeFS access |
|---|---|---|
| Model configuration and credentials | Dify model manager / Plugin Daemon | Dify inner model API |
| Datasource configuration, OAuth, and credentials | Dify datasource plugins | Dify inner datasource API |
| Physical object storage | Dify `STORAGE_TYPE` implementation | Dify inner storage API |
| KnowledgeFS relational state | KnowledgeFS database | `DATABASE_URL` |
| Complex document parsing | Unstructured-compatible service | `UNSTRUCTURED_API_URL` |
| PDF image rasterization | KnowledgeFS API image | Bundled Poppler `pdftoppm` executable |
| Capability signing | Dify | Public JWKS only in KnowledgeFS |

KnowledgeFS must never receive model-provider keys, datasource secrets, direct Plugin Daemon
credentials, or object-storage provider credentials.

## Dify Compose

The canonical service definitions are:

- `docker/docker-compose.yaml`
- `docker/docker-compose-template.yaml`
- `docker/envs/core-services/knowledge-fs.env.example`

The Compose service:

- starts by default with the rest of Dify;
- builds `knowledge-fs/apps/api/Dockerfile` when a prebuilt image is unavailable;
- remains on the internal `default` network and exposes only port `8787` to peer services;
- receives `DIFY_INNER_API_URL=http://api:5001`;
- receives the same inner API key used by Dify's plugin boundary;
- waits for the Dify API and its database dependency;
- uses `/health` for liveness and `/ready` for traffic readiness.

`KNOWLEDGE_INTEGRATED_MODE_ENABLED` controls Workspace provisioning/cutover behavior only. Whether
it is `false` or `true`, model, datasource, and object-storage calls always go through Dify.

## Operator-owned environment

The tracked KnowledgeFS environment example intentionally contains only settings that belong to
the service:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | KnowledgeFS PostgreSQL connection string. |
| `KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME` | Durable document worker rollout. |
| `KNOWLEDGE_PDF_RASTERIZER` | PDF image rasterizer. The production image defaults to `poppler`; set `off` as a kill switch. |
| `KNOWLEDGE_PDF_RASTERIZER_DPI` | Main PDF image resolution; the bounded deployment default is `144`. |
| `KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI` | Thumbnail resolution; the bounded deployment default is `48`. |
| `KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS` | Poppler subprocess timeout; the deployment default is `30000`. |
| `KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS` | Maximum PDF assets rasterized for one document; the deployment default is `500`. |
| `KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY` | Maximum concurrent Poppler page batches per API replica; defaults to `2` and accepts `1..8`. |
| `KNOWLEDGE_FS_CAPABILITY_V2_ENABLED` | Capability-v2 verifier rollout. |
| `KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS` | Public verification key set issued by Dify. |
| `KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED` | Opt in to query-image visual retrieval; requires an enabled visual-embedding provider/index and a query mode other than `off`. |
| `KNOWLEDGE_QUERY_IMAGE_EXPANSION_TIMEOUT_MS` | Timeout for the single Deep/Research vision expansion call; defaults to 8000 ms. |
| `UNSTRUCTURED_API_URL` | Parser endpoint for complex formats. |
| `UNSTRUCTURED_API_KEY` | Optional parser authentication. |
| `UNSTRUCTURED_MAX_CONCURRENCY` | Process-wide parser request limit; defaults to `2`. |
| `UNSTRUCTURED_REQUEST_TIMEOUT_MS` | Total timeout for one parser request and response body; defaults to `120000` and accepts up to `1800000` for long OCR documents. |
| `UNSTRUCTURED_MAX_RESPONSE_BYTES` | Maximum parser response body; defaults to `33554432` (32 MiB). |

Compose injects `DIFY_INNER_API_URL` and `DIFY_INNER_API_KEY`; do not duplicate them in the
operator-owned env file. Do not add `MINIO_*`, cloud object-storage credentials, provider API keys,
`PLUGIN_DAEMON_*`, datasource tokens, or OAuth client secrets.

`DIFY_OBJECT_STORAGE_REQUEST_TIMEOUT_MS` bounds each authenticated inner object-storage request,
including response consumption. It defaults to `60000`; transport failures and
408/409/425/429/5xx responses remain retryable at the durable compilation layer.

## PDF image rasterization

The production API image installs Poppler and verifies `pdftoppm` during the image build. Its image
defaults enable rasterization at 144 DPI, generate 48 DPI thumbnails, stop an individual Poppler
operation after 30 seconds, cap one document at 500 rasterized assets, and run at most two Poppler
page batches concurrently per API replica. The process still runs as the unprivileged `node` user.

The Dify Compose service keeps canonical values in
`docker/envs/core-services/knowledge-fs.env`, where they override the image defaults. It maps only
whitelisted `DIFY_ROOT_*_OVERRIDE` proxies, so an explicitly set PDF rasterizer value in
`docker/.env` takes precedence without exposing the rest of the root environment. An unset or
empty root value leaves the service env (or image default when that file is absent) in control.
Set `KNOWLEDGE_PDF_RASTERIZER=off` in either operator env during an incident or on a deliberately
constrained deployment. Do not set
`KNOWLEDGE_PDF_RASTERIZER_COMMAND` for the published image; its bundled command is on `PATH`.

Rasterization supplies durable image objects for PDF image elements when the parser returns layout
coordinates without image bytes. It does not repair already-published parse artifacts. Re-run the
document ingestion after deploying the corrected image to repopulate images that were previously
stored without an asset reference.

## Image-query rollout

The public Dify API accepts query images as actor-owned Dify `UploadFile` references. KnowledgeFS
does not receive storage credentials or persist a second copy of the bytes: Dify validates tenant
and account ownership, MIME, size, count, and aggregate size, then KnowledgeFS resolves each file
through the authenticated inner API for the lifetime of one query run.

Image-to-visual retrieval is independently disabled by default. Enable
`KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED=true` only when all of the existing
`KNOWLEDGE_VISUAL_EMBEDDING_*` settings select the same multimodal embedding space used to build
the published `visual_vector` projections, and `KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE` is
`fallback` or `primary`. An explicit query mode of `off` remains authoritative.

Fast performs no vision-LLM expansion. Deep and Research perform at most one bounded image-to-text
expansion through Dify's selected reasoning model; durable Research persists the derived text so
retry/replay does not repeat that call. Research then uses the derived text for document selection
and level-by-level PageIndex navigation before final synthesis. Model calls are included in the
Research dry-run estimate and durable budget accounting.

The request bounds are four images, 10 MiB per image, 32 MiB in aggregate, with MIME restricted to
PNG, JPEG, WebP, and GIF. Operational traces and terminal metadata use these stable degradation
reasons: `query-image-visual-leg-unavailable`, `query-image-ignored-no-vision-model`, and
`query-image-expansion-timeout`.

## Database release

Apply checked-in KnowledgeFS migrations through the controlled migration runner before scaling a
new binary:

```bash
pnpm db:migrations:check
pnpm local:db:migrate
```

Use the environment's normal migration job in production rather than running the local command
from an application container. The KnowledgeFS migration runner owns only KnowledgeFS tables. It
must not mutate existing Dify Dataset/Document tables or perform a production data migration.

Keep destructive legacy-removal flags disabled until the separately approved zero-traffic,
backup/restore, DBA, and CAB gates are complete.

## Readiness contract

Production `/ready` fails closed unless all enabled capabilities are assembled. The base checks
include:

- an authentication verifier;
- Dify model-runtime configuration;
- Dify datasource-runtime configuration;
- Dify object-storage configuration;
- durable database repositories required by enabled workers and product routes.

`/health` is liveness and component diagnostics; it is not permission to receive production
traffic. A service with `/health=200` and `/ready=503` must remain out of rotation.

Direct upload remains disabled because the Dify storage bridge deliberately does not expose
provider-specific presign or multipart primitives. Upload bytes pass through the bounded
KnowledgeFS API and Dify inner storage API.

## Release validation

Before publishing an image:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint:backend
pnpm openapi:export:test
pnpm db:migrations:check
pnpm dify:compose:config
pnpm docker:api:build
pnpm docker:api:bundle-smoke
git diff --check
```

The isolated bundle smoke is not a production dependency test. In a Dify-connected environment,
also verify:

1. `/health` and `/ready`.
2. A tenant-scoped KnowledgeSpace create/read.
3. A bounded document upload and object read through Dify storage.
4. Embedding, rerank, LLM, and model-catalog calls through Dify model instances.
5. Datasource validation/browse through a Dify-managed `credentialId`.
6. No model, datasource, OAuth, Plugin Daemon, or storage credentials appear in KnowledgeFS
   environment variables, requests, logs, or database rows.
7. Existing Dify knowledge-base flows remain unchanged.

## Workspace rollout

Roll out Workspace by Workspace. Keep the integrated-mode/capability flags disabled by default,
then enable only after the selected Workspace has:

- durable KnowledgeFS provisioning state;
- capability verification;
- successful model, datasource, and storage smoke;
- rollback evidence and monitoring ownership.

The rollout flag changes admission and provisioning behavior. It does not switch transports and
does not authorize a fallback runtime.

## Kubernetes

`infra/kubernetes/dify-integration-baseline.yaml` is an inert reference with zero replicas, an
internal `ClusterIP`, fail-closed probes, and no public ingress. A downstream Dify deployment may
adopt it only while preserving the same ownership boundaries.

## Rollback

Rollback the KnowledgeFS image or disable the affected Workspace cutover. Preserve KnowledgeFS
database rows and Dify-owned objects unless a reviewed recovery procedure says otherwise. Do not
rotate the Dify inner key, delete existing knowledge-base data, or redirect KnowledgeFS to a direct
storage/plugin endpoint as a rollback shortcut.

After rollback, rerun Dify-connected health and tenant smoke, confirm the existing knowledge-base
feature is unaffected, and record the release and rollback evidence.
