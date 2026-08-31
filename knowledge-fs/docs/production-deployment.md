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
- `docker/envs/core-services/knowledge-fs-unstructured.env.example`
- `docker/envs/core-services/knowledge-fs-unstructured-service.defaults`

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

To use the bundled isolated parser, copy `knowledge-fs.env.example` to `knowledge-fs.env` and start
Compose with `--profile knowledge-fs-unstructured`. The example points KnowledgeFS at
`http://knowledge_fs_unstructured:8000`. An external parser deployment may replace that endpoint
and tune the heavy-document limits without changing ordinary Office limits. Run
`pnpm dify:compose:config` from `knowledge-fs/` to validate the generated Dify Compose file together
with this optional profile from a clean checkout.

## Operator-owned environment

The tracked KnowledgeFS environment example intentionally contains only settings that belong to
the service:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | KnowledgeFS PostgreSQL connection string. |
| `KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME` | Durable document worker rollout. |
| `KNOWLEDGE_DOCUMENT_MATERIALIZATION_MAX_CONCURRENCY` | Process-wide limit for the complete source materialization phase across all supported formats (source read, parse, media extraction, thumbnail/object writes, and raw/canonical checkpoints). Defaults to `2`, accepts `1..8`, and falls back to the legacy PDF concurrency value when unset. The heavy pre-admission lane is capped at one less than this width (minimum `1`) so ordinary work retains a slot; increase this setting together with the heavy parser limit when intentionally enabling multiple heavy materializations. |
| `KNOWLEDGE_DOCUMENT_RETAINED_ARTIFACT_MAX_CONCURRENCY` | Process-wide count limit for canonical parse artifacts retained through outline, semantic, graph, and indexing stages. Defaults to `4` and accepts `1..32`. |
| `KNOWLEDGE_DOCUMENT_RETAINED_ARTIFACT_MAX_BYTES` | Aggregate conservative JS-heap charge for retained canonical parse artifacts. Defaults to `134217728` (128 MiB), accepts 1 MiB through 1 GiB, and lets one artifact at or above the budget run exclusively rather than deadlocking. |
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
| `KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_CONCURRENCY` | Process-wide active-request limit for the API-buffered upload compatibility path. Defaults to `2` and accepts `1..8`. |
| `KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_RESERVED_BYTES` | Aggregate source-byte reservation for admitted buffered uploads. Defaults to `31457280` (30 MiB), must be at least the configured per-file fallback limit, and is capped at 100 MiB. |
| `KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY` | Process-wide active-request limit for legacy/capability multipart document routes, acquired before Hono form validation. Defaults to `2` and accepts `1..8`. |
| `KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES` | Aggregate conservative retained-buffer charge for direct multipart uploads. Defaults to `201326592` (192 MiB). Each request reserves three times its bounded multipart envelope to cover the stream chunks, Hono body/FormData caches, and the handler `File.arrayBuffer` copy; this is an admission estimate, not an RSS guarantee. |
| `KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS` | Maximum continuous idle interval while reading a direct multipart or small-file fallback body. Defaults to `30000`; expiry cancels the reader, returns 408, and releases admission. |
| `KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS` | Generous total body-read deadline for a direct multipart or small-file fallback request. Defaults to `600000`, must be at least the idle timeout, and returns 408 on expiry. |
| `UNSTRUCTURED_API_URL` | Parser endpoint for complex formats. |
| `UNSTRUCTURED_API_KEY` | Optional parser authentication. |
| `UNSTRUCTURED_MAX_CONCURRENCY` | Process-wide limit shared by every remote parser request; defaults to `2`. |
| `UNSTRUCTURED_HEAVY_MAX_CONCURRENCY` | Nested limit for every PDF and structurally/byte-heavy Office, email, EPUB, ODT, or RTF request. The bundled parser profile uses `1`; it must not exceed `UNSTRUCTURED_MAX_CONCURRENCY`. The materialization pre-admission lane follows this value but is capped at `KNOWLEDGE_DOCUMENT_MATERIALIZATION_MAX_CONCURRENCY - 1` (minimum `1`) to preserve ordinary-document progress. `UNSTRUCTURED_PDF_MAX_CONCURRENCY` remains a lower-precedence compatibility alias. |
| `UNSTRUCTURED_MAX_INPUT_BYTES` | Maximum body admitted by the remote parser client. Defaults to `15728640` (15 MiB), matching the product upload default, and is capped at 50 MiB. Native parsing keeps its separate 10 MiB routing threshold. |
| `UNSTRUCTURED_REQUEST_TIMEOUT_MS` | Total timeout for an ordinary parser request and response body; defaults to `600000` (10 minutes) and accepts up to `3600000`. |
| `UNSTRUCTURED_HEAVY_REQUEST_TIMEOUT_MS` | Heavy-document total timeout. The bundled page-parallel profile uses `2400000`, below the `3600000` validation ceiling. `UNSTRUCTURED_PDF_REQUEST_TIMEOUT_MS` remains a lower-precedence compatibility alias. |
| `UNSTRUCTURED_MAX_RESPONSE_BYTES` | Maximum parser response body; defaults to `33554432` (32 MiB). |
| `UNSTRUCTURED_MAX_RETRIES` | In-process retry count for explicit retryable HTTP responses. Ambiguous transport failures are never retried inline. The integrated deployment uses `0`; durable compilation owns whole-attempt retries. |

Compose injects `DIFY_INNER_API_URL` and `DIFY_INNER_API_KEY`; do not duplicate them in the
operator-owned env file. Do not add `MINIO_*`, cloud object-storage credentials, provider API keys,
`PLUGIN_DAEMON_*`, datasource tokens, or OAuth client secrets.

`DIFY_OBJECT_STORAGE_REQUEST_TIMEOUT_MS` bounds each authenticated inner object-storage request,
including response consumption. It defaults to `60000`; transport failures and
408/409/425/429/5xx responses remain retryable at the durable compilation layer.

The optional `knowledge-fs-unstructured` Compose profile starts an isolated parser service with six
pages per child request, three child workers, and zero child retries. It does not modify Dify's
existing `unstructured` service or legacy ETL traffic. The tracked
`knowledge-fs-unstructured-service.defaults` file contains only service-side page-parallel values;
operator-owned `knowledge-fs-unstructured.env` is loaded afterwards and can override it. The
required file deliberately uses a non-`.env` suffix so it remains tracked in clean checkouts.
The `.env.example` files remain copy-only templates and are never loaded as runtime configuration.
Compose pins the isolated multi-architecture image to the digest used by the output-equivalence and
resource benchmarks; review the same contracts before intentionally changing that digest. Child
requests are at or below the split size and therefore partition locally instead of recursively
spawning more requests.

The KnowledgeFS client keeps a process-wide limit of `2` and adds a heavy-workload nested limit of
`1`. Every PDF remains heavy because compressed PDF object streams make a bounded page-count scan
unreliable. ZIP-backed remote formats become heavy when their admitted body exceeds 8 MiB or a
bounded central-directory inspection identifies a large container (for example, many slides,
sheets, entries, or more than 64 MiB of declared expanded content). Opaque legacy Office, RTF, and
mail containers use the heavy lane conservatively; remote inputs that remain standard receive the
600-second deadline. Declared ZIP64,
multi-disk, excessive-entry, or excessive-expansion containers are rejected before provider work;
the classifier never inflates entries and does not change parser output. Heavy requests receive the
2,400-second deadline. The isolated parser is capped at
four CPUs and 6 GiB in the reference Compose deployment. Those limits bound host impact, but the
upstream synchronous API has no cancellation or idempotency contract: a timed-out connection can
leave child work running. Unstructured transport timeouts are therefore terminal for automatic
durable retries; inspect the parser and retry manually after it is idle.
Multi-replica deployments need a shared admission layer because each incoming request creates its
own child thread pool. The Kubernetes baseline does not own an Unstructured deployment and retains
generic client limits. Operators with a different resource envelope must benchmark representative
narrative, table, and scanned pages before changing either concurrency limit.

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

## Canonical artifact retention bounds

The compilation claim batch may contain more documents than the source materialization limit. A
canonical `ParseArtifact` also remains live after parsing while outline generation, semantic
chunking, embedding, graph extraction, and index projection consume it. A process-wide FIFO
admission therefore bounds this later lifetime independently by both artifact count and a
conservative retained-byte estimate.

The estimator walks the existing object graph in place; it does not call `JSON.stringify` or copy
large strings. It charges strings as UTF-16 plus array/object/property overhead and stops once the
configured byte ceiling is reached. This is an admission estimate, not an exact V8 heap
measurement. An artifact charged at the full ceiling waits until it can run alone, so an operator
may lower the aggregate budget without making a previously accepted large document impossible.

Fresh and resumed compilations use the same gate. The materialization slot is handed off only
after the retained-artifact lease is acquired, which prevents completed artifacts from accumulating
in an unbounded memory queue. Downstream work never reacquires materialization, so the fixed lock
order does not introduce a gate cycle. Cancellation while queued never enters outline/index work,
and every success or failure releases the lease.

## Visual embedding memory bounds

Image-byte visual embedding is microbatched independently of the 128-node projection batch. The
default request limits are eight assets and 32 MiB of raw image bytes
(`KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS=8` and
`KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES=33554432`). The existing
`KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES` remains the per-image limit and must not exceed the
batch byte limit.

One process-wide visual lifecycle gate is shared by all document compilations in the API process.
`KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY` defaults to `2` and accepts values from `1` through
`8`. A queued compilation acquires this gate before it reads any image object and holds the slot
through every microbatch request. This bounds cross-document raw-image and base64 amplification;
queue cancellation is honored before object reads begin.

Image bodies use `getObjectStream`; visual embedding does not add one serial `HEAD` round trip per
image and does not call the adapter's broader buffered `getObject` path. The consumer accepts no
more than the configured number of source bytes, cancels the stream as soon as the next chunk would
cross that limit, and creates no contiguous image body larger than the limit. The production Dify
adapter forwards response chunks through its stream and does not first accumulate and concatenate
the complete object. For a valid multi-chunk image, the final bounded concatenate can temporarily
hold the accepted chunks and one equally bounded destination body. Conservative preflush bounds
that raw assembly peak by `MAX_BATCH_BYTES + MAX_ASSET_BYTES` per active lifecycle (52 MiB with the
defaults); the lifecycle gate limits simultaneous peaks across documents. Base64/JSON transport
representations require additional bounded headroom, so `MAX_BATCH_BYTES` is not an RSS limit.

Before the next body read, the adapter also flushes the current batch whenever its remaining byte
budget cannot hold one maximum-sized image. The provider still creates a transient base64
representation for Dify model-runtime transport, so the byte limit is a raw-image budget rather
than a whole-process heap ceiling. Keep the existing global model-request concurrency limit enabled
when increasing it.

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

Provider-direct presign and multipart upload remain unavailable because the Dify storage bridge
deliberately does not expose provider-specific primitives. The upload-session compatibility path
therefore streams each request into one bounded API buffer and writes it through the Dify inner
storage API. One process-shared admission gate is acquired before that buffer is allocated and held
until the object write finishes. It limits both active requests (default `2`) and aggregate retained
source bytes (default 30 MiB); a queued request that is cancelled never allocates its upload buffer.
The 15 MiB per-file product limit is unchanged. These limits are per API replica, so operators must
include replica count when sizing the deployment-wide memory envelope.

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
