# Docker deployment

Run Dify with Docker Compose. For the default deployment, copy `.env.example` to
`.env`, fill in the required token, and start the services. Defaults for the API,
workers, and supporting services load automatically; additional files are optional.

- [Start Dify](#start-dify)
- [Configure Dify](#configure-dify)
- [Troubleshoot setup and configuration](#troubleshoot-setup-and-configuration)
- [Review configuration after an upgrade](#review-configuration-after-an-upgrade)
- [Run middleware for development](#run-middleware-for-development)
- [Configure HTTPS and telemetry](#configure-https-and-telemetry)
- [Configure worker queues and webhooks](#configure-worker-queues-and-webhooks)
- [Enable the KnowledgeFS integration](#enable-the-knowledgefs-integration)
- [Configure client IP and trusted proxies](#client-ip-and-trusted-proxies)

## Start Dify

Before you begin, install Docker with a running daemon, Docker Compose **v2.35.0 or
later**, and OpenSSL to generate the sandbox token. Check your Compose version with
`docker compose version`. Version 2.35.0 or later is required for root `.env`
overrides to take precedence when Compose resolves service defaults.

For an existing deployment, edit your current `.env` instead of replacing it.
For a new deployment, follow these steps:

1. From the repository root, enter the Docker directory and copy the template:

   ```bash
   cd docker
   cp .env.example .env
   ```

   Unless noted otherwise, run commands below from `docker/`.

2. Generate a token:

   ```bash
   openssl rand -hex 32
   ```

   Open `.env` and paste the output as the value of
   `DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN`. Keep
   `COMPOSE_PROFILES=weaviate,postgresql,collaboration` for the default deployment.
   No other configuration files are required.

3. Start the services and check their status:

   ```bash
   docker compose up -d
   docker compose ps --all
   ```

   Wait for the long-running services to start and their health checks to pass.
   The one-time `init_permissions` service is expected to exit with code `0`.

4. Open [http://localhost/install](http://localhost/install) and complete the
   initial setup. If you changed the published HTTP port, use that port in the URL.

Before using this deployment in production, replace the bundled credentials using
[the security template](envs/security.env.example) and the matching service files,
and configure [HTTPS](#configure-https-and-telemetry) and
[trusted proxies](#client-ip-and-trusted-proxies).

## Configure Dify

### Choose the configuration file

| File | Purpose | Loaded directly? |
| --- | --- | --- |
| `.env.example` | Minimal template for required deployment inputs | No; copy it to `.env` |
| `.env` | Deployment inputs and explicit overrides, including Compose settings | Yes |
| `envs/**/*.defaults` | Tracked defaults for the matching services | Yes, automatically |
| `envs/**/*.env` | Optional service or provider overrides | Yes, when the matching service references the file |
| `envs/**/*.env.example` | Templates for optional application and provider settings | No; remove `.example`, except for the middleware template below |
| `envs/middleware.env.example` | Template for the separate source-code development stack | No; copy to `middleware.env` in `docker/` |

Keep settings with usable defaults out of the root `.env.example`. To customize a
service, copy its `.defaults` file to the override path named in its comments,
usually replacing `.defaults` with `.env` in the same directory. Edit the copy,
or the existing `.env` if one is already present. Uncomment only the optional
assignments you want to change; leave unused empty values and placeholders
commented. For an optional `.env.example` template, review its comments and fill
in the settings before use.

Find settings in:

- [Core services](envs/core-services/): API, workers, web, plugin daemon, and
  sandboxes. [api-worker.defaults](envs/core-services/api-worker.defaults) contains the
  common API, worker, and Beat settings, grouped by function. API process options
  live in `api.defaults`; worker autoscaling lives in `worker.defaults`.
- [Databases](envs/databases/): PostgreSQL, MySQL, and Redis.
- [Vector stores](envs/vectorstores/): bundled and external vector databases,
  including their API/worker client settings. Providers without a dedicated
  template are documented in `api-worker.defaults`.
- [Infrastructure](envs/infrastructure/): nginx, Certbot, proxies, and supporting services.

### Change a service setting

For example, to set nginx's upload limit to `200M`:

1. Create the optional override file if it does not already exist:

   ```bash
   cp envs/infrastructure/nginx.defaults envs/infrastructure/nginx.env
   ```

2. In `envs/infrastructure/nginx.env`, replace the input setting with:

   ```dotenv
   NGINX_CLIENT_MAX_BODY_SIZE=200M
   ```

   Leave expressions under `Container variable mappings` unchanged. They translate
   input names such as `SANDBOX_WORKER_TIMEOUT` into the container's `WORKER_TIMEOUT`.

3. Apply the change and inspect nginx's active configuration:

   ```bash
   docker compose up -d
   docker compose exec -T nginx nginx -T 2>&1 | grep client_max_body_size
   ```

   The output should contain `client_max_body_size 200M;`.

Use `docker compose up -d` after editing configuration files. Compose recreates
containers whose configuration changed. `docker compose restart` does not reload
environment variables. No extra `--env-file` option is needed for this deployment.

### Change a published port or another Compose setting

Put settings consumed by Compose in root `.env`: `COMPOSE_PROFILES`, published
ports, volume paths, resource limits, and health-check intervals. Service env
files cannot change those parts of the Compose model.

For example, add or update this line in `.env` to use HTTP port `8080`:

```dotenv
EXPOSE_NGINX_PORT=8080
```

Run `docker compose up -d`, then open
[http://localhost:8080/install](http://localhost:8080/install).
Use root `.env` for values shared with the isolated local Agent sandbox, including
its authentication token.

### Change shared plugin credentials

Set both shared plugin credentials in root `.env`, so every service receives the
same values:

| Root `.env` setting | Used by |
| --- | --- |
| `PLUGIN_DAEMON_KEY` | Plugin daemon authentication and its API, worker, and Agent clients |
| `PLUGIN_DIFY_INNER_API_KEY` | API inner-endpoint authentication and its plugin daemon, worker, Agent, and KnowledgeFS clients |

Generate a separate value for each key with `openssl rand -hex 32`, then add the two
assignments to `.env`. If you previously set these keys in a service `.env` file,
move them to root `.env`. Leave the derived container key expressions unchanged
when copying service defaults, including the Agent's derived key expressions.
Editing only `plugin-daemon.env`, `api.env`, or `worker.env` does not update every
consumer and can cause HTTP 401 responses.

Run `docker compose up -d` to apply the credentials to all affected services.
These optional overrides do not need to be added to `.env.example`.

### Select a database or vector store

In root `.env`, set `VECTOR_STORE` and update `COMPOSE_PROFILES` to select the
matching bundled vector store. Compose supplies its connection defaults to the
API, workers and Beat automatically. For example, a new deployment with Qdrant
and PostgreSQL uses:

```dotenv
VECTOR_STORE=qdrant
COMPOSE_PROFILES=qdrant,postgresql,collaboration
```

Changing `VECTOR_STORE` selects the default for new indexes. Existing knowledge
bases keep using their stored backend, so preserve its connection settings and
keep its service running. If any use bundled Weaviate, retain its profile with
`COMPOSE_PROFILES=weaviate,qdrant,postgresql,collaboration` for this example.

Bundled Weaviate connection defaults remain available when another provider is
selected. An unchanged bundled service needs no additional connection settings;
existing overrides in `weaviate.env`, `api-worker.env`, and `shared.env` still
apply, with root `.env` taking precedence.

To customize the connection, copy the provider's `.defaults` file under
`envs/vectorstores/` to its `.env` path if that file does not already exist. Edit
the copy or the existing `.env` file. Elasticsearch's two selectors use
`elasticsearch.env`. Existing provider `.env` and `shared.env`
overrides remain supported. Keep `VECTOR_STORE` in root `.env`, since Compose
selects the defaults file before reading service files.

For an external vector store, omit its bundled profile and provide its connection
settings and credentials. For databases with stored user passwords, change the
password in the database before updating the corresponding client setting.
Starting a different database or vector store does not migrate existing data.

For OpenSearch HTTPS connections, `OPENSEARCH_VERIFY_CERTS` defaults to `true`
whenever `VECTOR_STORE=opensearch`, even without the bundled `opensearch` profile.
Keep verification enabled for production and external HTTPS servers, and use
certificates trusted by the client.

The bundled OpenSearch image uses demo certificates. For local development with
those certificates, explicitly set `OPENSEARCH_VERIFY_CERTS=false` in
`envs/vectorstores/opensearch.env` or root `.env`. To keep verification enabled,
configure certificates trusted by the client.

For example, the default deployment selects PostgreSQL and Weaviate with
`COMPOSE_PROFILES=weaviate,postgresql,collaboration`. The `collaboration` profile
starts the WebSocket API. Set `DB_TYPE` and the SQL database's connection settings
when changing that provider. See the [database](envs/databases/) and
[vector store](envs/vectorstores/) files for provider-specific settings.

For a new deployment using bundled MySQL and Weaviate, set the complete connection
in root `.env`:

```dotenv
DB_TYPE=mysql
DB_HOST=db_mysql
DB_PORT=3306
DB_USERNAME=root
COMPOSE_PROFILES=weaviate,mysql,collaboration
```

Keep your selected vector-store profile if it differs from this example. The
MySQL profile starts the database; it does not replace the PostgreSQL connection
defaults. Set `DB_PASSWORD` to the same value used to initialize the MySQL server.
Changing these settings on an existing PostgreSQL deployment does not migrate its data.

### Configure sandbox credentials

Set `DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN` only in root `.env`, using the secret
generated during setup. Compose supplies it to both the Agent backend and its
local sandbox. Move any existing copy of this token from `dify-agent.env` to root
`.env` and remove the duplicate; keep the same secret during the move.

The separate Code sandbox uses two settings that must match: `SANDBOX_API_KEY`
in `envs/core-services/sandbox.env` and `CODE_EXECUTION_API_KEY` in
`envs/security.env` (copied from `security.env.example`). Use the same generated
secret in both files, then run `docker compose up -d` to apply both changes.
You can also set both variables to the same value in root `.env`.

### Understand which value takes effect

For services that load root `.env`, precedence is:

1. Root `.env` overrides.
2. Optional service `.env` overrides.
3. Tracked `.defaults` values, followed by application defaults for unset settings.

Other services, including databases, vector stores, and nginx, receive root values
only through `${...}` expressions in their defaults or explicit Compose mappings.
For those inputs, root `.env` takes precedence over the service file. Arbitrary
native container variables do not inherit this precedence: for example, put
Weaviate's `ASYNC_INDEXING` in `envs/vectorstores/weaviate.env`; adding it to root
`.env` alone does not configure the Weaviate container.

The `knowledge_fs_unstructured` parser loads its defaults followed by
`envs/core-services/knowledge-fs-unstructured.env`, without loading root `.env`.
Set its parsing options in that service file.

Shell variables take precedence when Compose interpolates `${...}` expressions.
An explicit Compose `environment` entry also takes precedence over service env
files; [trusted-proxy settings](#client-ip-and-trusted-proxies) are one example.
The [KnowledgeFS section](#enable-the-knowledgefs-integration) describes its
restricted root overrides separately.

The API, workers, and plugin daemon also read the database and Redis override
files, so shared connection settings reach both the bundled server and its clients.
Changing a PostgreSQL or MySQL initialization password does not rotate credentials
in an existing database; use the database's credential-rotation procedure as well.

## Troubleshoot setup and configuration

Validate the Compose configuration and inspect the affected services:

```bash
docker compose config --quiet
docker compose ps --all
docker compose logs --tail=100 api worker nginx
```

Replace the service names in the logs command with the service you are diagnosing.
A successful `config --quiet` produces no output; it validates the Compose model,
not application readiness.

| Symptom | What to check |
| --- | --- |
| Editing a template has no effect | Copy `.env.example` to `.env`, or a service template to its documented `.env` path. Templates ending in `.example` are not loaded. |
| A service still uses its old value | Run `docker compose up -d`. Check for a higher-priority value in root `.env`, the shell, or an explicit Compose `environment` entry. |
| A port or profile change has no effect | Put the setting in root `.env`; these settings cannot be supplied through a service env file. |
| Service overrides resolve unexpectedly | Check that Docker Compose is v2.35.0 or later and that container-variable mapping expressions are intact. |
| Python sandbox code returns `operation not permitted` | Check the network-setting note in [sandbox.defaults](envs/core-services/sandbox.defaults). Sandbox 0.2.15 restricts the `epoll_pwait` syscall when networking is disabled on both ARM64 and AMD64. The runtime failure has been reproduced on ARM64. |

## Review configuration after an upgrade

Review the new root `.env.example` for required deployment inputs and the matching
`.defaults` files for changed service defaults. Preserve your existing `.env`
files; a copied service file can pin values from an older release.

Review any saved `OPENSEARCH_VERIFY_CERTS=false`: it stays in effect after an
upgrade. Remove the assignment or set it to `true` to enable certificate
verification.

Bundled service templates now use the `.defaults` extension. Existing service
`.env` paths still work. Root `.env.example` remains the only required starting
template, and the Compose generator creates only a missing root `.env`.

Common API and worker application settings are documented in
[api-worker.defaults](envs/core-services/api-worker.defaults). New customizations
use `envs/core-services/api-worker.env`. Existing `shared.env` files and other
service override paths remain supported; keep local files and edit them in place.
If both `shared.env` and `api-worker.env` exist, `api-worker.env` takes precedence
for matching settings. Root `.env` retains precedence over both files, including
for settings documented in a provider template.

Review accidental empty assignments left by older template copies. For example,
`CELERY_WORKER_AMOUNT=` overrides the Docker default of `4` and lets the worker
entrypoint fall back to `1`. Remove or comment out that assignment to restore
the Docker default. Likewise, remove accidental empty `SERVER_WORKER_CLASS=`
or `GUNICORN_TIMEOUT=` entries to restore `gevent` and `360`. Keep intentional
overrides; the configuration loader does not rewrite or discard them.

To merge new root-template keys into an existing `.env`, optionally run:

```bash
bash dify-env-sync.sh
```

The script backs up `.env` to `env-backup/.env.backup_<timestamp>`, adds missing
keys from `.env.example`, preserves existing values and extra local overrides,
and reports differences for review. It does not synchronize the files in `envs/`.
Review the resulting settings before running `docker compose up -d`.

## Run middleware for development

Use `docker-compose.middleware.yaml` when running the application from source and
you need its supporting services in Docker.

1. Create `middleware.env` if it does not exist:

   ```bash
   cp envs/middleware.env.example middleware.env
   ```

2. Edit database and other middleware settings, then start the services:

   ```bash
   docker compose --env-file middleware.env -f docker-compose.middleware.yaml -p dify up -d
   ```

This separate workflow requires `--env-file middleware.env`. The template defines
`COMPOSE_PROFILES=${DB_TYPE:-postgresql},weaviate`, which selects the database and
Weaviate. Update that value if you need different profiles.

## Configure HTTPS and telemetry

For HTTPS certificates, follow the [Certbot guide](certbot/README.md).

For OpenTelemetry, create `envs/core-services/api-worker.env` from `api-worker.defaults`
if it does not exist. Uncomment `ENABLE_OTEL` and set it to `true`; uncomment
`OTLP_BASE_ENDPOINT` and set it to your collector's endpoint, reachable from
the API and worker containers. The same file documents optional `OTEL_*`
tuning. Apply the changes with `docker compose up -d`.

## Configure worker queues and webhooks

Custom worker queue lists set through `CELERY_QUEUES` or `CELERY_WORKER_QUEUES` must include
`human_input_delivery` to process durable Human Input IM inbox events and recover
unconfirmed Human Input v2 notifications, and
`human_input_contact_sync` to process manual IM Contact directory synchronization.

Human Input IM channels in `WEBHOOK` mode build their Callback URL from `TRIGGER_URL`.
Set it to the externally reachable HTTPS origin of the API when configuring a remote
deployment. A localhost value is only suitable for local development. Reverse proxies
must forward `/callbacks/human-input/v2/im/` to the API and preserve the request path,
body, and provider signature headers. Copy the channel's Callback URL into the
provider's interaction configuration after changing the public origin.

### Ops tracing rolling upgrades

New tracing tasks use `OPS_TRACE_QUEUE=ops_trace_v2` by default. Set it consistently on the API,
workers, and Beat in `docker/envs/core-services/api-worker.env` (or `docker/.env`). Default worker
subscriptions follow this value; explicit `CELERY_QUEUES` or `CELERY_WORKER_QUEUES` lists must
include it and exclude legacy `ops_trace` while old workers are draining.

Keep an old tracing worker pool on `ops_trace` until old producers stop and their queued, active, reserved, scheduled, and
retry tasks finish. To return to `ops_trace`, first remove old workers, have new workers consume
both queues, then change `OPS_TRACE_QUEUE` on all new processes and drain `ops_trace_v2` before
removing its consumers. See the [complete rollout sequence](../api/providers/trace/README.md#rolling-upgrade-from-the-previous-pipeline).

## Enable the KnowledgeFS integration

The optional `knowledge-fs` Compose profile starts the internal KnowledgeFS API service and the
dedicated Dataset upgrade worker. The API service publishes no host port and has no nginx route.
Model, datasource, and object-storage calls go through Dify's inner API.
Dify resolves active Workspace/plugin configuration and remains the only owner of physical
storage credentials. `KNOWLEDGE_FS_ENABLED` remains `false`, so starting the container does not
enable product traffic.

Copy the dedicated service template if the local file does not already exist:

```bash
cp envs/core-services/knowledge-fs.env.example envs/core-services/knowledge-fs.env
```

Fill in the operator-owned inputs described in `knowledge-fs.env` before starting
the services. The default image is the CI-published deployment-branch image; set
`KNOWLEDGE_FS_API_IMAGE` to pin another tag or immutable SHA tag. If the image
repository is private, authenticate with `docker login` before pulling:

```bash
docker compose --profile knowledge-fs --profile knowledge-fs-unstructured config --quiet
docker compose --profile knowledge-fs --profile knowledge-fs-unstructured pull knowledge_fs knowledge_fs_unstructured
docker compose --profile knowledge-fs --profile knowledge-fs-unstructured up -d
```

The service env file intentionally contains only operator-owned inputs: the dedicated database,
durable compilation switch, Capability v2 public verification material, and optional Unstructured
endpoint. Compose injects the Dify inner API connection and integrated mode. KnowledgeFS stores
objects below an internal namespace in Dify's configured `STORAGE_TYPE`; do not duplicate Dify's
bucket, endpoint, or provider credentials in `knowledge-fs.env`. Feature-specific rollout flags
and capacity tunables should be added only when deliberately overriding their safe runtime
defaults.

### Configure document parsing

The optional `knowledge-fs-unstructured` profile starts one isolated parser service named
`knowledge_fs_unstructured` for every KnowledgeFS remote format. Its tracked
`knowledge-fs-unstructured-service.defaults` additionally enables bounded page parallelism for
PDFs and a 25-million-pixel pre-allocation limit per page at the pinned 350 DPI; an optional copied
`knowledge-fs-unstructured.env` can override those service values. Do not raise the DPI or pixel
limit, or disable the guard: the KnowledgeFS client estimates page rasters at 350 DPI and rejects
oversized or unverifiable page geometry before sending it to the parser. Oversized pages need
smaller page dimensions or tiling before import; reducing compressed file size alone does not
help. Existing installations need the new KnowledgeFS image and a recreated parser service to
activate both guards. The existing `unstructured` profile remains unchanged for Dify's legacy
ETL, so KnowledgeFS tuning cannot alter its PDF or Office parsing behavior. The copied
`knowledge-fs.env` pairs every PDF and structurally/byte-heavy remote document with the longer
deadline and narrower admission gate; ordinary formats retain two concurrent requests and a
600-second timeout, while heavy work uses one concurrent request and a 2,400-second timeout. The
remote input cap defaults to 15 MiB so the parser accepts the complete product upload envelope. The
legacy `UNSTRUCTURED_PDF_*` names remain lower-precedence compatibility aliases. The isolated
service is available to KnowledgeFS at `http://knowledge_fs_unstructured:8000`; it does not
publish a host port.

### Configure PDF image rendering

The KnowledgeFS API image includes Poppler and enables its `pdftoppm` PDF image rasterizer with
bounded defaults (144 DPI, 48 DPI thumbnails, a 30-second timeout, at most 500 assets per document,
and two concurrent Poppler page batches per replica). Canonical settings live in the dedicated
`knowledge-fs.env`; whitelisted `DIFY_ROOT_*_OVERRIDE` proxies let explicitly set values in
`docker/.env` take precedence without injecting the complete root environment. When a root value
is unset, the service env or image default remains authoritative. Set
`KNOWLEDGE_PDF_RASTERIZER=off` in either operator env as an emergency or low-resource kill switch. Existing
documents whose parse artifacts lack image asset references must be ingested again after rollout.

### Check storage and readiness before enabling traffic

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

### Run lifecycle and upgrade workers

The standard Dify worker consumes `knowledge_fs_lifecycle` for provisioning, deletion, initial
source imports, and staged-upload cleanup. Deployments overriding `CELERY_QUEUES` or
`CELERY_WORKER_QUEUES` must include this queue in a worker pool. Enable the lifecycle rollout gates
on the API, workers, and Beat before creating spaces.

Classic Dataset upgrades use the separate `worker_knowledge_fs_upgrade` service. It starts with
the `knowledge-fs` Compose profile, so enable that profile before submitting an upgrade. This
worker must use `CELERY_WORKER_POOL=prefork`; for local development, run
`./dev/start-worker --queues knowledge_fs_upgrade --pool prefork` from the repository root.
Each checkpoint has a 570-second
soft limit and a 600-second hard limit. Do not override these task limits: recovery relies on the
child having stopped before reclaiming its execution window. Beat checks for abandoned running
jobs and publication claims every minute after the lifecycle gates are ready. Claims without
progress for 11 minutes can be recovered automatically or through the upgrade retry endpoint.
Stop existing upgrade workers before deploying this recovery change, then recreate the API,
worker, upgrade worker, and Beat with the new image and pool configuration.

Document reconciliation has its own durable delivery lease after the parent upgrade succeeds.
Beat also scans successful upgrades with unfinished document checkpoints, so a failed publication
or interrupted reconciliation is retried without restarting the upgrade. Unclaimed successful jobs
are eligible immediately; lost deliveries are reclaimed after the 11-minute lease expires, and
completed attempts with unfinished work become eligible again after one minute. Apply the
`b9d3f7a5c102` migration before starting the updated processes; existing successful upgrades receive
NULL leases and are picked up automatically. Reconciliation uses the same prefork pool and
570/600-second task limits. Keep Beat running with the lifecycle rollout gates enabled.

Upgrade uploads retain their logical document identity before compilation finishes, so pending
or failed documents can have their legacy disabled state restored without an active revision.
Reconciliation releases a deleted document's checkpoint only after verifying a completed durable
deletion receipt for that identity; a missing document or upstream error alone is not sufficient.
Custom metadata is restored from the snapshot's field definitions, converting Classic UTC epoch
seconds to ISO timestamps for time fields. Classic built-in fields are omitted because KnowledgeFS
owns its system metadata. These corrections also apply when retrying existing unfinished
checkpoints and require no additional migration.

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
precedence over `envs/core-services/api-worker.env` and legacy `shared.env` files.
Existing `false` overrides in `docker/.env`, the invoking shell, or a Compose
override remain in effect during upgrades. Move settings previously supplied only
by `api-worker.env` or `shared.env` to one of those override locations if you need to preserve them.
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
