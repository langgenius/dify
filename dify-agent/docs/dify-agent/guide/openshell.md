# OpenShell Runtime Backend

This guide covers OpenShell-specific configuration, deployment, and validation.
See the [Operations Guide](index.md) for shared server configuration and
scheduling behavior.

## Configuration

`ServerSettings` loads environment variables with the `DIFY_AGENT_` prefix. It
also reads `.env` and `dify-agent/.env` when present. Select
`DIFY_AGENT_RUNTIME_BACKEND=openshell` to use this backend. Shared settings,
including Agent Stub and file-service URLs, are documented in the
[server configuration reference](index.md#configuration).

| Environment variable | Default | Description |
| --- | --- | --- |
| `DIFY_AGENT_OPENSHELL_GATEWAY_ENDPOINT` | empty | OpenShell gateway gRPC endpoint as `host:port` (no scheme); required for OpenShell. Prefer `localhost` over an IPv6 literal when the gateway listens on loopback. |
| `DIFY_AGENT_OPENSHELL_WORKSPACE` | `default` | OpenShell workspace that owns the sandboxes. |
| `DIFY_AGENT_OPENSHELL_BEARER_TOKEN` | empty | Static OIDC bearer token sent to the gateway. Combines with the mTLS bundle. The token is not refreshed in-process; restart `agent_backend` or switch to a long-lived token when it expires. |
| `DIFY_AGENT_OPENSHELL_TLS_CA_PATH` | empty | Custom gateway CA certificate path. Empty uses the system trust store. |
| `DIFY_AGENT_OPENSHELL_TLS_CLIENT_CERT_PATH` | empty | mTLS client certificate path; set together with the key path. |
| `DIFY_AGENT_OPENSHELL_TLS_CLIENT_KEY_PATH` | empty | mTLS client key path; set together with the certificate path. |
| `DIFY_AGENT_OPENSHELL_INSECURE` | `false` | Use a plaintext gRPC channel. Local development only. |
| `DIFY_AGENT_OPENSHELL_SANDBOX_IMAGE` | `langgenius/dify-agent-local-sandbox:latest` | Build the runtime image yourself from this checkout and explicitly set this to the resulting image reference. Do not rely on the code fallback or a published `latest` tag: older images may lack `iproute2`, which the OpenShell supervisor requires alongside shellctl. The env templates use the self-built `docker.io/library/dify-agent-runtime:latest`; see the build command below. |
| `DIFY_AGENT_OPENSHELL_DRIVER_CONFIG` | empty | Optional JSON `SandboxTemplate.driver_config` as a driver-keyed envelope (for example `{"docker": {...}}`); empty sends an empty driver config. Use it for driver-specific options such as custom mounts. |
| `DIFY_AGENT_OPENSHELL_EGRESS_ALLOW` | empty | Optional comma-separated `host:port` egress allowlist (no scheme or path). Empty sends no network policy (gateway/driver default egress). When set, sandbox egress is enforced to exactly these endpoints — include the Agent Stub and files endpoints. |
| `DIFY_AGENT_OPENSHELL_SHELLCTL_AUTH_TOKEN` | empty | Required high-entropy master secret. The backend derives a stable per-sandbox shellctl bearer token from it (HMAC-SHA256 keyed by this secret over the canonical sandbox name); only the derived token reaches the bootstrap `SHELLCTL_AUTH_TOKEN` export and data-plane `Authorization` headers through the bearer-passthrough service endpoint. The master stays backend-side, never enters a sandbox, and must be identical on all `agent_backend` replicas. Empty is rejected at startup. |
| `DIFY_AGENT_OPENSHELL_SHELLCTL_PORT` | `5004` | Sandbox-loopback port shellctl listens on; reached through the gateway's native exposed-service endpoint. |
| `DIFY_AGENT_OPENSHELL_READY_TIMEOUT_SECONDS` | `300` | Maximum wait for a sandbox to reach the READY phase. |
| `DIFY_AGENT_OPENSHELL_EXEC_TIMEOUT_SECONDS` | `120` | Timeout for gateway exec calls (bootstrap and maintenance scripts). |

## Deploy with the OpenShell backend

The OpenShell backend runs each Binding in its own sandbox on a self-hosted
[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) gateway. Dify Agent
talks to the gateway's gRPC API to create sandboxes from the configured image
and bootstrap shellctl through gateway exec, and to the gateway's HTTP service
listener for the shellctl data plane, which is reached through the native
service exposure (`ExposeService`) that routes HTTP to the sandbox's loopback
port. See the upstream
[sandbox overview](https://github.com/NVIDIA/OpenShell/blob/v0.1.3/docs/how-it-works/sandboxes/overview.mdx)
for how exposed services work.

The service is exposed with bearer passthrough: `Authorization` on data-plane
requests reaches shellctl unchanged and carries the per-sandbox token derived
from `DIFY_AGENT_OPENSHELL_SHELLCTL_AUTH_TOKEN` — the configured value itself
is a backend-only master secret and is never sent to sandbox services. The
deployment gateway credential
(`DIFY_AGENT_OPENSHELL_BEARER_TOKEN`) stays on the gRPC control plane and is
never sent to sandbox services. The configured CA and client certificates
also authenticate the HTTPS service transport where applicable; certificates
are transport material, never forwarded as headers.

New Bindings are initialized and then stopped. Acquire starts a stopped sandbox
when needed, verifies its Home and Workspace, ensures shellctl is running, and
refreshes the persistent name-keyed service endpoint (sandbox ids change across
restarts; the endpoint is shared by all leases). Release closes only that
lease's HTTP client; it does not delete the endpoint, stop the sandbox, or
stop shellctl. Subsequent operations can reuse the running sandbox, and
releasing one lease does not interrupt another lease on the same Binding.

There is no automatic idle-stop or sandbox TTL in this adapter. After a
successful acquire/release cycle, the sandbox remains running until explicitly
stopped or destroyed, or a runtime failure stops it. Operators must account for
these running resources. Binding creation still stops the newly initialized
sandbox; a failed acquire closes only that attempt's lease-local clients and
does not stop the sandbox or interrupt other leases on it.
Explicitly stopped sandboxes are restarted on the next acquire.

Backend selection lives in `docker/.env`; create it from the template first if
this deployment does not have one yet (`cp docker/.env.example docker/.env`).

Deployment prerequisites:

1. An OpenShell gateway, version 0.1.3 or newer (the bundled SDK is pinned
   `>=0.1.3,<0.2.0` — the gateway and SDK must be upgraded together; service
   exposure requires the gateway to honor `authorization_mode`), reachable
   from `agent_backend` at `DIFY_AGENT_OPENSHELL_GATEWAY_ENDPOINT`, with
   credentials via `DIFY_AGENT_OPENSHELL_BEARER_TOKEN` or the mTLS bundle
   paths. Prefer `localhost:17670` when the gateway listens on loopback.
   Sandboxes reconnect to the gateway through `host.openshell.internal`; on
   macOS local development bind the gateway to `127.0.0.1:17670` so that
   alias can reach it.
   The Dify API and Agent Backend deploy the nullable Home Snapshot contract
   together: an Agent Backend that reports `snapshot_ref: null` (OpenShell)
   requires an API that treats null as "no snapshot" — an older API expecting
   a string would misbehave, so upgrade both services in lockstep.

   Exposed service traffic still traverses the gateway listener. For plain
   `http` service URLs on `*.openshell.localhost`, the Agent Backend dials
   `127.0.0.1` on the returned port and sends the returned authority on `Host`
   (wildcard localhost DNS is not reliably resolved). **This works only when
   the Agent Backend shares the gateway's loopback network** — a local
   process or an explicitly shared network namespace; a separate-container or
   remote Agent Backend would dial *itself* at `127.0.0.1`. Those
   deployments require a gateway-configured `https` service domain instead
   (upstream service-domain/SAN configuration): the operator must provide
   DNS for the service domain, a gateway certificate whose SANs cover it,
   and a service listener port reachable from the Agent Backend.
   `https` service URLs keep their returned hostname for SNI and routing.
2. Sandboxes must reach `DIFY_AGENT_STUB_API_BASE_URL` and
   `DIFY_AGENT_SANDBOX_FILES_BASE_URL`. When the gateway runs outside this
   Compose stack, set both to externally reachable URLs; compose-internal
   hostnames are not resolvable from OpenShell sandboxes. When the
   deployment restricts sandbox egress, set
   `DIFY_AGENT_OPENSHELL_EGRESS_ALLOW` so the sandbox policy carries an
   enforced allowlist covering at least those two endpoints:

   ```text
   DIFY_AGENT_OPENSHELL_EGRESS_ALLOW=agent.example.com:443,dify.example.com:443
   ```

   Left empty (the default), the policy carries no network rules and egress
   follows the gateway/driver default — a stock Docker driver leaves sandbox
   outbound unrestricted, which agent-run tools (package installs, web
   access) may rely on. When set, egress is restricted to exactly the listed
   endpoints, from any in-sandbox binary.

3. **Build the runtime image yourself from the current checkout.** It must
   bundle shellctl and `iproute2`. A published or cached
   `langgenius/dify-agent-local-sandbox:latest` is not a substitute: older images
   lack `iproute2`, causing the OpenShell supervisor to exit during startup.
4. A required `DIFY_AGENT_OPENSHELL_SHELLCTL_AUTH_TOKEN` — a high-entropy
   master secret shared by all `agent_backend` replicas. Each sandbox's
   shellctl is bootstrapped with a per-sandbox token derived from it, so one
   sandbox's credential does not authenticate against another sandbox.
   Bootstrap sets `SHELLCTL_ENABLE_PATH_ISOLATION=false` because the
   sandbox Landlock policy is authoritative; stacking both would require
   re-granting every device path twice. The derived token authenticates the
   in-sandbox command plane.

   Upgrade caveat: a running shellctl keeps the token it was started with,
   and the unauthenticated `/healthz` readiness check does not detect a
   token mismatch. When upgrading from a version that used a shared
   deployment-wide token, or when rotating the master secret, quiesce or
   drain active work and stop/start the existing sandboxes so each shellctl
   restarts with its derived credential; acquire alone will not restart a
   healthy stale shellctl. On upgrade, generate a **fresh** high-entropy
   master secret — do not reuse the previously shared token, which already
   entered sandboxes: anyone who learned it could otherwise derive every
   per-sandbox token. Roll the new master out to all `agent_backend`
   replicas together, since replicas with different masters derive
   different tokens.
5. Home Snapshots are **not supported** by this backend: OpenShell has no
   native snapshot capability, `create_from_runtime` reports `snapshot_ref:
   null`, and every new Binding is materialized image-fresh — a supplied
   snapshot ref is ignored rather than honored approximately. Build Apply
   saves the config but does not checkpoint the filesystem; a running
   sandbox keeps its state across stop/start, but a newly created Binding
   starts from the image's default Home.

Build from the repository root (the directory containing `dify-agent-runtime/`):

```bash
docker build -f dify-agent-runtime/docker/Dockerfile \
  -t dify-agent-runtime:latest dify-agent-runtime
```

Set the **exact built image reference** in `dify-agent/.env` for a local Agent
Backend process, or in `docker/.env` for Docker Compose:

```ini
DIFY_AGENT_OPENSHELL_SANDBOX_IMAGE=docker.io/library/dify-agent-runtime:latest
```

The gateway's Docker driver must use the same Docker daemon containing this
image. For a remote gateway or a multi-node deployment, tag and push the image
to a registry accessible to the compute nodes and configure that registry
reference instead. A local build on your laptop is not available to a remote
gateway automatically. If the configured tag is absent, the driver attempts to
pull it; a mismatched name can fail with `ImagePullFailed` / `pull access denied`.

Configure the backend in `docker/.env`. The full `DIFY_AGENT_OPENSHELL_*`
variable reference lives in `docker/envs/core-services/dify-agent.defaults`;
values may also be set in the `envs/core-services/dify-agent.env` env_file,
but `docker/.env` is loaded last into `agent_backend` and overrides it. These
lines are `.env` file content, not shell commands — values are taken verbatim,
so the `driver_config` JSON needs no quoting:

```ini
# docker/.env
DIFY_AGENT_RUNTIME_BACKEND=openshell
DIFY_AGENT_OPENSHELL_GATEWAY_ENDPOINT=gateway.example.com:17670
DIFY_AGENT_OPENSHELL_BEARER_TOKEN=replace-with-gateway-token
DIFY_AGENT_OPENSHELL_SANDBOX_IMAGE=docker.io/library/dify-agent-runtime:latest
DIFY_AGENT_OPENSHELL_DRIVER_CONFIG={}
DIFY_AGENT_OPENSHELL_SHELLCTL_AUTH_TOKEN=replace-with-shellctl-token
```

Then start the stack normally:

```bash
docker compose -f docker/docker-compose.yaml up -d
```

The Local backend's `local_sandbox` container and its dedicated SSRF proxy
stay in the stack unused, exactly as they do in an E2B deployment. The standard
Compose file does not build the OpenShell runtime image or provision its
gateway; complete the prerequisites above and the deployment-specific
networking and certificate setup below before starting the stack.

## Validate the OpenShell deployment

For local development, run the API and Agent Backend from the current checkout.
Copy `dify-agent/.example.env` to `dify-agent/.env`, select
`DIFY_AGENT_RUNTIME_BACKEND=openshell`, and build the runtime image as described
above. The local template targets `localhost:17670` and the Homebrew gateway's
mTLS bundle; adjust those paths if your gateway registration has a different
name. Install Agent Backend dependencies with `uv sync --extra server` from
`dify-agent/` before starting the server.

For Docker Compose, use `docker/docker-compose.yaml` and explicitly configure
your deployment:

- Use API and Agent Backend images containing the OpenShell integration. If your
  images predate it, build them from the checkout using `api/Dockerfile` and
  `dify-agent/Dockerfile`, and update the corresponding Compose service image
  references. Building the runtime image alone does not update these services.
- The gateway endpoint must be reachable from the `agent_backend` container.
  For a gateway on the Docker host, use `host.docker.internal:17670`, not
  `localhost:17670`. On Linux Docker, add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to that service and ensure
  the gateway listens on a container-reachable address. Verify that the gateway
  certificate covers the hostname you use.
  That covers only the gRPC control plane: `*.openshell.localhost` service URLs
  are dialled at `127.0.0.1`, which inside a container means the container
  itself — a separate-container or remote `agent_backend` must deploy a
  gateway-configured `https` service domain with DNS, covering certificate
  SANs, and a service listener port reachable from `agent_backend`. Do not
  point `openshell.localhost` at the gateway via `extra_hosts`; Host-header
  routing requires the returned authority, but the dial target is hardwired
  to loopback.
- When using mTLS, add a read-only bind mount for the gateway client bundle to
  `agent_backend` and set `DIFY_AGENT_OPENSHELL_TLS_*_PATH` to the paths **inside
  the container**. There is no automatic certificate mount. Ensure the service
  user can traverse the mounted directory and read the files; copy the bundle
  to a dedicated directory with appropriate permissions rather than mounting
  the CLI's private gateway directory directly.
- Set sandbox-reachable Agent Stub and file-service URLs. Any required service
  port publishing must be configured explicitly; the Agent Backend control
  plane should remain private.

The runtime image must be available to the gateway's compute driver, not merely
in the Docker daemon used to build the API or Agent Backend images.

Smoke-test through the Agent Backend control plane. Set `AGENT_BACKEND_BASE_URL`
to its reachable service root (`http://localhost:5050` for a local process on
port 5050), and export the matching `DIFY_AGENT_API_TOKEN` from your deployment.
Use a disposable test tenant and binding; the destroy request deletes the test
sandbox and its workspace.

```bash
curl -s -w '\n%{http_code}\n' -X POST "$AGENT_BACKEND_BASE_URL/execution-bindings" \
  -H "Authorization: Bearer $DIFY_AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"smoke-tenant","agent_id":"smoke-agent","binding_id":"smoke-binding-1","workspace_id":"smoke-ws-1"}'
# → {"binding_ref":"dify-<digest>","workspace_ref":"dify-<digest>"} then 201
curl -s -w '\n%{http_code}\n' -X POST "$AGENT_BACKEND_BASE_URL/execution-bindings/destroy" \
  -H "Authorization: Bearer $DIFY_AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"binding_ref":"<binding_ref>","destroy_workspace":true,"workspace_ref":"<binding_ref>"}'
# → 204
```

A created ref verifies gateway authentication, sandbox startup from the
configured runtime image, and Binding initialization.

## Run the OpenShell integration contract

Run the real OpenShell contract against a reachable gateway; pass the
gateway credential through the bearer-token or mTLS-path variables that match
your gateway:

```bash
cd dify-agent
DIFY_AGENT_TEST_OPENSHELL_GATEWAY_ENDPOINT=gateway.example.com:17670 \
DIFY_AGENT_TEST_OPENSHELL_SANDBOX_IMAGE=docker.io/library/dify-agent-runtime:latest \
DIFY_AGENT_TEST_OPENSHELL_BEARER_TOKEN=replace-with-gateway-token \
  uv run --extra server pytest --import-mode=importlib \
  tests/integration/dify_agent/runtime_backend/test_working_environment.py \
  -k openshell -q -rs
```

The contract creates unique resources and performs explicit cleanup in `finally`
blocks.
