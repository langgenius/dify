# Docker deployment

Run Dify with Docker Compose. Configuration templates live in `.env.example` and `envs/`; local overrides belong in `.env`.

## How to Deploy Dify with `docker-compose.yaml`

1. **Prerequisites**: Ensure Docker and Docker Compose v2.24.0 or later are installed on your system.
2. **Environment Setup**:
   - Navigate to the `docker` directory.
   - Copy `.env.example` to `.env`.
   - Customize `.env` when you need to change essential startup defaults. Copy optional files from `envs/` without the `.example` suffix when you need advanced settings.
   - **Optional (for advanced deployments)**:
     If you maintain a full `.env` file copied from `.env.example`, you may use the environment synchronization tool to keep it aligned with the latest `.env.example` updates while preserving your custom settings.
     See the [Environment Variables Synchronization](#environment-variables-synchronization) section below.
3. **Running the Services**:
   - Execute `docker compose up -d` from the `docker` directory to start the services.
   - To specify a vector database, set the `VECTOR_STORE` variable in your `.env` file to your desired vector database service, such as `milvus`, `weaviate`, or `opensearch`. See `envs/vectorstores/` for the full list of supported options.
   ```bash
   cp .env.example .env
   docker compose up -d
   ```

4. **SSL Certificate Setup**:
   - Refer to [the Certbot guide](certbot/README.md) to set up SSL certificates using Certbot.
5. **OpenTelemetry Collector Setup**:
   - Copy `envs/core-services/shared.env.example` to `envs/core-services/shared.env`.
   - Set `ENABLE_OTEL=true` and configure `OTLP_BASE_ENDPOINT`. Tune the other `OTEL_*` knobs in the same file if needed.

## KnowledgeFS Integration Service

The default deployment starts an internal KnowledgeFS API service. It publishes no host port and
has no nginx route. Model, datasource, and object-storage calls go through Dify's inner API.
Dify resolves active Workspace/plugin configuration and remains the only owner of physical
storage credentials. `KNOWLEDGE_FS_ENABLED` remains `false`, so starting the container does not
enable product traffic.

Copy and fill the dedicated service configuration before enabling KnowledgeFS traffic. The default
image is the CI-published deployment-branch image; set `KNOWLEDGE_FS_API_IMAGE` to pin another tag
or immutable SHA tag. If the image repository is private, authenticate the deployment host with
`docker login` before pulling:

```bash
cp envs/core-services/knowledge-fs.env.example envs/core-services/knowledge-fs.env
docker compose --profile knowledge-fs-unstructured config
docker compose --profile knowledge-fs-unstructured pull knowledge_fs knowledge_fs_unstructured
docker compose --profile knowledge-fs-unstructured up -d
```

The service env file intentionally contains only operator-owned inputs: the dedicated database,
durable compilation switch, Capability v2 public verification material, and optional Unstructured
endpoint. Compose injects the Dify inner API connection and integrated mode. KnowledgeFS stores
objects below an internal namespace in Dify's configured `STORAGE_TYPE`; do not duplicate Dify's
bucket, endpoint, or provider credentials in `knowledge-fs.env`. Feature-specific rollout flags
and capacity tunables should be added only when deliberately overriding their safe runtime
defaults.

The optional `knowledge-fs-unstructured` profile starts one isolated parser service named
`knowledge_fs_unstructured` for every KnowledgeFS remote format. Its tracked
`knowledge-fs-unstructured-service.defaults` additionally enables bounded page parallelism for
PDFs and a 25-million-pixel pre-allocation limit per page at the pinned 350 DPI; an optional copied
`knowledge-fs-unstructured.env` can override those service values. Do not raise the DPI or pixel
limit, or disable the guard: the KnowledgeFS client estimates page rasters at 350 DPI and rejects
oversized or unverifiable page geometry before sending it to the parser. Oversized pages need
smaller page dimensions or tiling before import; reducing compressed file size alone does not
help. Existing installations need the new KnowledgeFS image and a recreated parser service to
activate both guards. The
existing `unstructured` profile remains unchanged for Dify's legacy ETL, so KnowledgeFS tuning
cannot alter its PDF or Office parsing behavior. The copied
`knowledge-fs.env` pairs every PDF and structurally/byte-heavy remote document with the longer
deadline and narrower admission gate; ordinary formats retain two concurrent requests and a
600-second timeout, while heavy work uses one concurrent request and a 2,400-second timeout. The
remote input cap defaults to 15 MiB so the parser accepts the complete product upload envelope. The
legacy `UNSTRUCTURED_PDF_*` names remain lower-precedence compatibility aliases. The required
defaults file deliberately does not end
in `.env`, so it remains tracked and a clean checkout can validate the profile; files ending in
`.env.example` are copy-only templates and are never loaded as runtime configuration. The isolated
service is available to KnowledgeFS at `http://knowledge_fs_unstructured:8000`; it does not publish
a host port.

The KnowledgeFS API image includes Poppler and enables its `pdftoppm` PDF image rasterizer with
bounded defaults (144 DPI, 48 DPI thumbnails, a 30-second timeout, at most 500 assets per document,
and two concurrent Poppler page batches per replica). Canonical settings live in the dedicated
`knowledge-fs.env`; whitelisted `DIFY_ROOT_*_OVERRIDE` proxies let explicitly set values in
`docker/.env` take precedence without injecting the complete root environment. When a root value
is unset, the service env or image default remains authoritative. Set
`KNOWLEDGE_PDF_RASTERIZER=off` in either operator env as an emergency or low-resource kill switch. Existing
documents whose parse artifacts lack image asset references must be ingested again after rollout.

Use a dedicated KnowledgeFS database. Do not point `DATABASE_URL` at Dify's application database,
reuse Dataset/Document tables, or run a data migration as part of this service. KnowledgeFS
migrations remain a separate controlled operator step. The selected Dify storage backend must
support recursive `scan`; the currently verified paths are S3 and OpenDAL/local.

The production entrypoint supports the explicitly selected Capability v2 verifier and accepts only
public JWKS material. The `knowledge_fs` container can still return `200` from
`/health` while `/ready` returns `503` when the verifier or another durable dependency is missing;
this is intentional fail-closed behavior. Do not add a proxy route, set
`KNOWLEDGE_FS_ENABLED=true`, or send product traffic until readiness returns `200` and the migration
and per-Workspace cutover gates are complete.

### KnowledgeFS lifecycle and upgrade workers

The standard Dify worker consumes `knowledge_fs_lifecycle` for provisioning, deletion, initial
source imports, and staged-upload cleanup. Deployments overriding `CELERY_QUEUES` or
`CELERY_WORKER_QUEUES` must include this queue in a worker pool. Enable the lifecycle rollout gates
on the API, workers, and Beat before creating spaces.

Classic Dataset upgrades use the separate `worker_knowledge_fs_upgrade` service. This worker must
use `CELERY_WORKER_POOL=prefork`; local development uses
`./dev/start-worker --queues knowledge_fs_upgrade --pool prefork`. Each checkpoint has a 570-second
soft limit and a 600-second hard limit. Do not override these task limits: recovery relies on the
child having stopped before reclaiming its execution window. Beat checks for abandoned running
jobs and publication claims every minute after the lifecycle gates are ready. Claims without
progress for 11 minutes can be recovered automatically or through the upgrade retry endpoint.
Stop existing upgrade workers before deploying this recovery change, then recreate the API,
worker, upgrade worker, and Beat with the new image and pool configuration.

## Client IP and trusted proxies

Dify uses the request's resolved client IP for rate limits and audit records. The
bundled Nginx overwrites `X-Forwarded-For` with `$remote_addr`, and Compose enables
`RESPECT_XFORWARD_HEADERS_ENABLED` for the API and WebSocket API services. Dify's
proxy middleware trusts one forwarded value, so different visitors keep separate
IP buckets while caller-supplied IP headers cannot override Nginx's address.

The middleware does not authenticate the proxy. Keep the API port private and
restrict direct API connections to trusted callers. Compose does not publish that
port, but services on its shared Docker networks can still connect directly,
including the code sandbox on `ssrf_proxy_network`. Those connections bypass
Nginx's header replacement. If those workloads are untrusted, enforce network or
firewall isolation and route their API calls through a sanitizing gateway before
enabling forwarded-header trust. Merely setting a Docker network to `internal`
does not isolate containers from each other.

For a directly exposed API, leave `RESPECT_XFORWARD_HEADERS_ENABLED=false`.
The Python configuration and `api/.env.example` retain that default. To override
the Compose default, set the variable in `docker/.env`, the shell used by Compose,
or a Compose override. The API services' explicit `environment` entry takes
precedence over `envs/core-services/shared.env`.
Existing `false` overrides in `docker/.env`, the invoking shell, or a Compose
override remain in effect during upgrades. Move settings previously supplied only
by `shared.env` to one of those override locations if you need to preserve them.
After establishing the trusted ingress boundary, enable the setting to retain
visitor IPs.

### Cloudflare or another load balancer before Nginx

With an upstream proxy, configure Nginx to resolve the visitor address before
forwarding it. Otherwise `$remote_addr` is the upstream proxy's address, and its
visitors share a rate-limit bucket. Add an operator-managed
`docker/nginx/conf.d/real-ip.conf`; the existing mount and Nginx include load this
file without changes to the entrypoint.

For a load balancer that supplies a correctly maintained `X-Forwarded-For` chain:

```nginx
# Replace this documentation address with the actual trusted proxy address/CIDR.
set_real_ip_from 192.0.2.10/32;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

For Cloudflare connecting directly to Nginx, use `real_ip_header CF-Connecting-IP`
and `set_real_ip_from` entries for Cloudflare's current published IPv4 and IPv6
ranges. Restrict origin access to the intended Cloudflare path; a Tunnel or
Authenticated Origin Pulls with your own certificate can authenticate your zone.
Cloudflare IP ranges alone identify its network, not your zone. If another load
balancer sits between Cloudflare and Nginx, validate the source and sanitize
headers at that load balancer too. Do not trust an arbitrary Cloudflare header
merely because an internal load balancer forwarded it.

Never use `0.0.0.0/0`, `::/0`, or an entire untrusted workload network as the trusted
proxy range. Reload Nginx after updating its configuration. See the
[Nginx real-IP module](https://nginx.org/en/docs/http/ngx_http_realip_module.html),
[Cloudflare IP ranges](https://www.cloudflare.com/ips/), and
[Cloudflare origin protection](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/).

### Kubernetes

Use stable workload selectors to restrict API access; individual ingress pod IPs
do not need to be configured in Dify. The ingress must resolve and overwrite the
forwarded client IP as above. Keep the API Service as `ClusterIP`, set
`RESPECT_XFORWARD_HEADERS_ENABLED=true` on its Deployment, and enforce a
NetworkPolicy on the API pods. `ClusterIP` alone does not restrict other pods.

This example must be adapted to your namespaces, pod labels, and API port:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-from-ingress
  namespace: dify
spec:
  podSelector:
    matchLabels:
      app: dify-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-system
          podSelector:
            matchLabels:
              app: ingress-controller
      ports:
        - protocol: TCP
          port: 5001
```

Both selectors belong to the same `from` entry, so the namespace **and** pod labels
must match. Keep that namespace restricted to trusted workloads. Confirm that
your CNI enforces NetworkPolicy, no other policy broadly allows API access, and
any `hostNetwork` ingress is covered by your CNI's policy behavior. Allow rules
from multiple policies are additive. See the
[Kubernetes NetworkPolicy documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/).

Inventory internal API callers before applying the policy. Route untrusted
callers through the same sanitizing ingress; directly allowed callers can supply
forwarded headers too. Internal requests without a verified visitor address are
attributed to the calling service, not an end user. Preserve required internal
service connectivity while enforcing this boundary.

Before rollout, verify that two distinct visitor IPs use different limit buckets,
changing client-supplied IP headers does not change the resolved address, and an
untrusted pod cannot connect directly to the API. IP limits still need independent
account/email limits because NAT can share public addresses and attackers can
use multiple real addresses.

## How to Deploy Middleware for Developing Dify

1. **Middleware Setup**:
   - Use the `docker-compose.middleware.yaml` for setting up essential middleware services like databases and caches.
   - Navigate to the `docker` directory.
   - Ensure the `middleware.env` file is created by running `cp envs/middleware.env.example middleware.env` (refer to the `envs/middleware.env.example` file).
2. **Running Middleware Services**:
   - Navigate to the `docker` directory.
   - Execute `docker compose --env-file middleware.env -f docker-compose.middleware.yaml -p dify up -d` to start PostgreSQL/MySQL (per `DB_TYPE`) plus the bundled Weaviate instance.

> Compose automatically loads `COMPOSE_PROFILES=${DB_TYPE:-postgresql},weaviate` from `middleware.env`, so no extra `--profile` flags are needed. Adjust variables in `middleware.env` if you want a different combination of services.

## Overview of `.env`, `.env.example`, and `envs/`

- `.env.example` contains the essential default configuration for Docker Compose deployments.
- `.env` contains local startup values copied from `.env.example` and any local changes.
- `envs/*.env.example` files contain optional advanced configuration grouped by theme.

Keep the root `.env.example` limited to variables required to start the default Docker Compose deployment.
Do not add optional, advanced, provider-specific, or service-specific variables there; place them in the appropriate `envs/*.env.example` file instead.

Docker Compose reads `envs/*.env` files when present, then reads `.env` last so values in `.env` take precedence.

For the available variables and defaults, read the matching `envs/**/*.env.example` template and its service in `docker-compose.yaml`.

## Environment Variables Synchronization

When upgrading Dify or pulling the latest changes, new environment variables may be introduced in `.env.example` only when they are required for startup,
or in the optional files under `envs/` for advanced, provider-specific, and service-specific settings.

If you use the default workflow, review `.env.example` and keep your `.env` aligned with essential startup values.

If you maintain a customized `.env` file copied from `.env.example`, an optional environment variables synchronization tool is provided.

> This tool performs a **one-way synchronization** from `.env.example` to `.env`.
> Existing values in `.env` are never overwritten automatically.

### `dify-env-sync.sh` (Optional)

This script compares your current `.env` file with the latest `.env.example` template and helps safely apply new or updated environment variables.

**What it does**

- Creates a backup of the current `.env` file before making any changes
- Synchronizes newly added environment variables from `.env.example`
- Preserves all existing custom values in `.env`
- Displays differences and variables removed from `.env.example` for review

**Backup behavior**

Before synchronization, the current `.env` file is saved to the `env-backup/` directory with a timestamped filename
(e.g. `env-backup/.env.backup_20231218_143022`).

**When to use**

- After upgrading Dify to a newer version with a full `.env` file
- When `.env.example` has been updated with new environment variables
- When managing a large or heavily customized `.env` file copied from `.env.example`

**Usage**

```bash
# Grant execution permission (first time only)
chmod +x dify-env-sync.sh

# Run the synchronization
./dify-env-sync.sh
```
