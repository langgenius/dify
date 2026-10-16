# Docker deployment

Run Dify with Docker Compose. Configuration templates live in `.env.example` and `envs/`; local overrides belong in `.env`.

## How to Deploy Dify with `docker-compose.yaml`

1. **Prerequisites**: Ensure Docker and Docker Compose v2.24.0 or later are installed on your system.
2. **Environment Setup**:
   - Navigate to the `docker` directory.
   - Copy `.env.example` to `.env`.
   - Customize `.env` when you need to change essential startup defaults. Copy optional files from `envs/` without the `.example` suffix when you need advanced settings.
   - **Optional (for advanced deployments)**:
     If you maintain a full `.env` file copied from `.env.example`, you may use the environment synchronization tool to keep it aligned with the latest `.env.example` updates while retaining existing values for variables that remain in the template.
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
> Existing values are retained only for variables that remain in `.env.example`.
> Variables absent from the template are omitted from the rewritten `.env` and remain available in the backup.

### `dify-env-sync.sh` (Optional)

This script compares your current `.env` file with the latest `.env.example` template and helps safely apply new or updated environment variables.

**What it does**

- Creates a backup of the current `.env` file before making any changes
- Rebuilds `.env` using the comments, ordering, and variables from `.env.example`
- Preserves existing values for variables that remain in `.env.example`
- Adds newly introduced variables with their `.env.example` defaults
- Reports and omits variables that are absent from `.env.example`

**Backup behavior**

Before synchronization, the current `.env` file is saved to the `env-backup/` directory with a timestamped filename
(e.g. `env-backup/.env.backup_20231218_143022`).
Use this backup to recover custom comments, ordering, or variables that are not present in `.env.example`.

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
