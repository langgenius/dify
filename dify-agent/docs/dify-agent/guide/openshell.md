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
| `DIFY_AGENT_OPENSHELL_WORKSPACE` | `default` | OpenShell workspace that owns the sandboxes. Production multi-tenant deployments must use one workspace and one dedicated shared volume per tenant. |
| `DIFY_AGENT_OPENSHELL_BEARER_TOKEN` | empty | Static OIDC bearer token sent to the gateway. Combines with the mTLS bundle. The token is not refreshed in-process; restart `agent_backend` or switch to a long-lived token when it expires. |
| `DIFY_AGENT_OPENSHELL_TLS_CA_PATH` | empty | Custom gateway CA certificate path. Empty uses the system trust store. |
| `DIFY_AGENT_OPENSHELL_TLS_CLIENT_CERT_PATH` | empty | mTLS client certificate path; set together with the key path. |
| `DIFY_AGENT_OPENSHELL_TLS_CLIENT_KEY_PATH` | empty | mTLS client key path; set together with the certificate path. |
| `DIFY_AGENT_OPENSHELL_INSECURE` | `false` | Use a plaintext gRPC channel. Local development only. |
| `DIFY_AGENT_OPENSHELL_SANDBOX_IMAGE` | `langgenius/dify-agent-local-sandbox:latest` | Build the runtime image yourself from this checkout and explicitly set this to the resulting image reference. Do not rely on the code fallback or a published `latest` tag: older images may lack `iproute2`, which the OpenShell supervisor requires alongside shellctl. The env templates use the self-built `docker.io/library/dify-agent-runtime:latest`; see the build command below. |
| `DIFY_AGENT_OPENSHELL_DRIVER_CONFIG` | empty | JSON `SandboxTemplate.driver_config`; required for OpenShell and must be a non-empty object. Must mount the shared Home Snapshot volume at the shared mount path in every sandbox. |
| `DIFY_AGENT_OPENSHELL_SHARED_MOUNT_PATH` | `/mnt/dify-agent-shared` | In-sandbox mount path of the shared volume; Home Snapshots live under `home-snapshots/<tenant-digest>/`. |
| `DIFY_AGENT_OPENSHELL_EGRESS_ALLOW` | empty | Optional comma-separated `host:port` egress allowlist (no scheme or path). Empty sends no network policy (gateway/driver default egress). When set, sandbox egress is enforced to exactly these endpoints — include the Agent Stub and files endpoints. |
| `DIFY_AGENT_OPENSHELL_SHELLCTL_AUTH_TOKEN` | empty | Required bearer token the exec-bootstrapped shellctl expects on its data plane. Empty is rejected at startup. |
| `DIFY_AGENT_OPENSHELL_SHELLCTL_PORT` | `5004` | Sandbox-loopback port shellctl listens on; reached through the gateway `ForwardTcp` tunnel. |
| `DIFY_AGENT_OPENSHELL_READY_TIMEOUT_SECONDS` | `300` | Maximum wait for a sandbox to reach the READY phase. |
| `DIFY_AGENT_OPENSHELL_EXEC_TIMEOUT_SECONDS` | `120` | Timeout for gateway exec calls (bootstrap and maintenance scripts). |

## Deploy with the OpenShell backend

The OpenShell backend runs each Binding in its own sandbox on a self-hosted
[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) gateway. Dify Agent
only talks to the gateway gRPC API: it creates sandboxes from the configured
image, bootstraps shellctl through gateway exec, and reaches the shellctl data
plane through an authenticated `ForwardTcp` tunnel.

New Bindings are initialized and then stopped. Acquire starts a stopped sandbox
when needed, verifies its Home and Workspace, ensures shellctl is running, and
opens a fresh lease-local tunnel. Release closes only that lease's HTTP client
and tunnel; it does not stop the sandbox or shellctl. Subsequent operations can
reuse the running sandbox, and releasing one lease does not interrupt another
lease on the same Binding.

There is no automatic idle-stop or sandbox TTL in this adapter. After a
successful acquire/release cycle, the sandbox remains running until explicitly
stopped or destroyed, or a runtime failure stops it. Operators must account for
these running resources. Binding creation and failed-acquire cleanup retain
their existing stop behavior; this change only makes lease release lightweight.
Explicitly stopped sandboxes are restarted on the next acquire.

Backend selection lives in `docker/.env`; create it from the template first if
this deployment does not have one yet (`cp docker/.env.example docker/.env`).

Deployment prerequisites:

1. An OpenShell gateway, version 0.0.106 or newer (validated against
   0.0.106–0.0.110; the bundled SDK is pinned `>=0.0.106,<0.1.0`), reachable
   from `agent_backend` at `DIFY_AGENT_OPENSHELL_GATEWAY_ENDPOINT`, with
   credentials via `DIFY_AGENT_OPENSHELL_BEARER_TOKEN` or the mTLS bundle
   paths. Prefer `localhost:17670` when the gateway listens on loopback.
   Sandboxes reconnect to the gateway through `host.openshell.internal`; on
   macOS local development bind the gateway to `127.0.0.1:17670` so that
   alias can reach it.
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
4. A required `DIFY_AGENT_OPENSHELL_SHELLCTL_AUTH_TOKEN`. shellctl is
   bootstrapped with `SHELLCTL_ENABLE_PATH_ISOLATION=false` because the
   sandbox Landlock policy is authoritative; stacking both would require
   re-granting every device path twice. The token still authenticates the
   in-sandbox command plane.
5. A shared Home Snapshot volume mounted into every sandbox via
   `DIFY_AGENT_OPENSHELL_DRIVER_CONFIG`. Production multi-tenant deployments
   must use one OpenShell workspace and one dedicated volume per tenant:
   Landlock is best-effort and every sandbox runs as the same image UID, so a
   shared volume is a shared trust boundary. Snapshots are stored under
   `home-snapshots/<tenant-digest>/`; the sandbox policy grants only that
   tenant directory.

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

Initialize the volume once. It is operator-owned and shared with the OpenShell
gateway, so create it with these commands rather than declaring it in a compose
file — `docker compose down -v` on a managing stack would delete every Home
Snapshot. Docker named volume (single-tenant local development; `1777` is not
a multi-tenant control):

```bash
docker volume create dify-agent-shared
docker run --rm -v dify-agent-shared:/mnt busybox \
  sh -c "mkdir -p /mnt/home-snapshots && chmod 1777 /mnt /mnt/home-snapshots"
```

Kubernetes: provision one ReadWriteMany PVC per tenant trust zone and mount
it read-write at `DIFY_AGENT_OPENSHELL_SHARED_MOUNT_PATH` through that
driver's `driver_config` (shape is driver-specific; the Docker example
above is the local-dev analogue). Initialize the volume with an
initContainer or `fsGroup` so the sandbox UID can write
`home-snapshots/` — do not rely on `chmod 1777` as isolation.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dify-agent-shared-tenant-a
spec:
  accessModes: ["ReadWriteMany"]
  resources:
    requests:
      storage: 20Gi
```

Configure the backend in `docker/.env`. The full `DIFY_AGENT_OPENSHELL_*`
variable reference lives in `docker/envs/core-services/dify-agent.env.example`;
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
DIFY_AGENT_OPENSHELL_DRIVER_CONFIG={"docker":{"mounts":[{"type":"volume","source":"dify-agent-shared","target":"/mnt/dify-agent-shared","read_only":false}]}}
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

Home Snapshots are directory copies under
`<shared mount>/home-snapshots/<tenant-digest>/`; snapshot deletion runs a
short-lived maintenance sandbox granted only that tenant's snapshot root
(unlinking the snapshot directory itself requires write on its parent).

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
  Keep the Agent Backend's glibc ≥ 2.39 base (`python:3.12-slim-trixie` in its
  Dockerfile): the bundled OpenShell wheel requires it.
- The gateway endpoint must be reachable from the `agent_backend` container.
  For a gateway on the Docker host, use `host.docker.internal:17670`, not
  `localhost:17670`. On Linux Docker, add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to that service and ensure
  the gateway listens on a container-reachable address. Verify that the gateway
  certificate covers the hostname you use.
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
configured runtime image, and Binding initialization. Home Snapshot operations
also require the initialized shared volume described above.

## Run the OpenShell integration contract

Run the real OpenShell contract against a reachable gateway. The driver config
must mount an initialized shared Home Snapshot volume (see the OpenShell
deployment section above); pass the gateway credential through the bearer-token
or mTLS-path variables that match your gateway:

```bash
cd dify-agent
DIFY_AGENT_TEST_OPENSHELL_GATEWAY_ENDPOINT=gateway.example.com:17670 \
DIFY_AGENT_TEST_OPENSHELL_SANDBOX_IMAGE=docker.io/library/dify-agent-runtime:latest \
DIFY_AGENT_TEST_OPENSHELL_DRIVER_CONFIG='{"docker":{"mounts":[{"type":"volume","source":"dify-agent-shared","target":"/mnt/dify-agent-shared","read_only":false}]}}' \
DIFY_AGENT_TEST_OPENSHELL_BEARER_TOKEN=replace-with-gateway-token \
  uv run --extra server pytest --import-mode=importlib \
  tests/integration/dify_agent/runtime_backend/test_working_environment.py \
  -k openshell -q -rs
```

The contract creates unique resources and performs explicit cleanup in `finally`
blocks.
