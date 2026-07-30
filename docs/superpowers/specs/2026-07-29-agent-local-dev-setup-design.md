# Dify Agent Local Development Setup Design

## Goal

Extend `make dev-setup` so a developer can run the Dify Agent backend from
source while Docker Compose starts the Agent local sandbox and its dedicated
SSRF proxy.

## Developer Workflow

Running `make dev-setup` will:

1. keep preparing the existing API, web, and middleware dependencies;
2. create `dify-agent/.env` from `dify-agent/.example.env` when it is missing;
3. install the Dify Agent development and server dependencies;
4. start `local_sandbox` and `agent_ssrf_proxy` as part of the existing
   `dify-middlewares-dev` Compose project.

The command will not background the source-based Agent process. Developers
will start that long-running process explicitly with:

```bash
./dev/start-agent
```

The script will run the Agent backend from `dify-agent/` with Uvicorn reload
enabled and listen on `127.0.0.1:5050`, matching the existing
`AGENT_BACKEND_BASE_URL=http://localhost:5050` API development default.

## Compose Architecture

`docker/docker-compose.middleware.yaml` will gain:

- `local_sandbox`, using the same local sandbox image contract as the generated
  deployment Compose file;
- `agent_ssrf_proxy`, using the existing Agent-specific Squid entrypoint and
  configuration;
- an internal proxy network shared only by those two containers.

The Agent proxy will publish
`127.0.0.1:${EXPOSE_AGENT_LOCAL_SANDBOX_PORT:-5004}:5004` and reverse-proxy that
port to the sandbox shellctl service. Binding it to the loopback interface
prevents remote hosts from accessing shellctl while allowing the source-based
Agent process to use `http://localhost:5004`. Publishing through the proxy is
required because Docker Desktop does not expose ports directly from a container
attached only to an internal network.

The sandbox will not join the default middleware network. Its HTTP and HTTPS
traffic will use `agent_ssrf_proxy`; its `NO_PROXY` setting will cover only
localhost and loopback. The proxy remains the sandbox's only network peer and
owns both its outbound SSRF policy and host shellctl bridge.

## Host Bridge and SSRF Policy

The source Agent backend and API run on the host, while the sandbox runs in
Docker. The Agent will therefore advertise
`http://host.docker.internal:5050/agent-stub` to sandbox jobs.

The dedicated Squid configuration will support configurable Agent and API
destination hostnames. Deployment Compose will retain its current defaults
(`agent_backend` and `api`), while middleware Compose will use
`host.docker.internal` for both destinations and add the Docker
`host-gateway` mapping for Linux compatibility. For Docker Desktop, Squid will
resolve host upstreams explicitly to IPv4 before connecting, avoiding the
unreachable IPv6 address that Docker Desktop also advertises. These origin
peers will disable cache-digest discovery and prohibit direct fallback so a
failed peer check cannot silently reroute requests to that IPv6 address. The
Agent peer will pass through the sandbox's per-run Authorization header so the
Agent Stub can validate its JWE; this passthrough is not enabled for the API
peer.

The existing path restrictions remain unchanged:

- the Agent destination allows only `/agent-stub/*`;
- the API destination allows only `/files/*`;
- other private-network destinations remain denied;
- public internet traffic remains allowed through the proxy.

This preserves the production network policy while supporting source processes
on the host.

## Local Agent Configuration

`dify-agent/.example.env` will provide development defaults compatible with
`make dev-setup`:

- authenticated Redis at `localhost:6379`, using the middleware development password;
- plugin daemon at `localhost:5002`;
- Dify API inner endpoints at `localhost:5001`;
- local sandbox at `localhost:5004`;
- Agent Stub URL at `host.docker.internal:5050/agent-stub`;
- development API and inner API keys matching the existing middleware and API
  examples.

Existing `dify-agent/.env` files will not be overwritten.

## Make Targets and Cleanup

A focused `prepare-agent` target will own Agent environment creation and
dependency installation. `dev-setup` will depend on it, and the help output and
`.PHONY` declarations will be updated.

Because the new containers use the existing middleware Compose file and project
name, `dev-clean` will stop them through its existing Compose `down` command.
The local sandbox service will not add a host-persisted workspace volume, so no
new destructive cleanup command is required.

## Verification

Automated checks will verify:

- the middleware Compose configuration renders successfully;
- both Agent sandbox services are present;
- shellctl port `5004` binds only to `127.0.0.1`;
- the sandbox is attached only to its internal proxy network;
- Squid receives the host destination configuration;
- `start-agent` launches the source server on port `5050` with reload;
- `make -n dev-setup` includes Agent preparation without starting the Agent
  process itself.

The existing SSRF proxy test will also be run after parameterizing destination
hostnames. Generated deployment Compose output will be regenerated and checked
only if its template or generator-owned inputs change.

## Compatibility

The existing `make dev-setup`, `prepare-docker`, API, web, and cleanup behavior
will remain intact. Existing local environment files are preserved, production
Compose defaults remain unchanged, and no API or runtime contract changes are
introduced.
