# Operating the Dify Agent Run Server

This guide describes how to run the MVP Dify Agent API server. The server is
implemented in `dify-agent/src/dify_agent/server/app.py` and uses Redis for run
records and per-run event streams only.

## Default local startup

Start Redis, then run one FastAPI/uvicorn process:

```bash
uv run --project dify-agent uvicorn dify_agent.server.app:app --reload
```

By default, the FastAPI lifespan creates:

- one Redis-backed run store used by HTTP routes
- shared plugin-daemon and Dify API inner `httpx.AsyncClient` instances
- one deployment-selected, stateless runtime backend profile when configured
- one process-local scheduler that starts background `asyncio` run tasks

This means local development needs one uvicorn process plus Redis, and
plugin-backed runs also need a reachable Dify plugin daemon. Run execution still
happens outside request handlers, so client disconnects do not cancel the agent
run.

## Configuration

`ServerSettings` loads environment variables with the `DIFY_AGENT_` prefix. It
also reads `.env` and `dify-agent/.env` when present.

| Environment variable | Default | Description |
| --- | --- | --- |
| `DIFY_AGENT_REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL. |
| `DIFY_AGENT_REDIS_PREFIX` | `dify-agent` | Prefix for Redis record and event keys. |
| `DIFY_AGENT_SHUTDOWN_GRACE_SECONDS` | `30` | Seconds to wait for active local runs during graceful shutdown before cancellation. |
| `DIFY_AGENT_RUN_RETENTION_SECONDS` | `259200` | Seconds to retain Redis run records and per-run event streams; defaults to 3 days. |
| `DIFY_AGENT_PLUGIN_DAEMON_URL` | `http://localhost:5002` | Base URL for the Dify plugin daemon. |
| `DIFY_AGENT_PLUGIN_DAEMON_API_KEY` | empty | API key sent to the Dify plugin daemon. |
| `DIFY_AGENT_INNER_API_URL` | `http://localhost:5001` | Dify API service root used when dify-agent calls `/inner/api/...` endpoints. |
| `DIFY_AGENT_INNER_API_KEY` | empty | API key sent to Dify API inner plugin endpoints. Set this to Dify API `INNER_API_KEY_FOR_PLUGIN` (Docker: `PLUGIN_DIFY_INNER_API_KEY`). |
| `DIFY_AGENT_RUNTIME_BACKEND` | `local` | Selects one coherent `local`, `enterprise`, or `e2b` Home Snapshot + Execution Binding backend profile. |
| `DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT` | empty | Local shellctl data-plane URL. With the default Local selection, leaving it empty disables `dify.runtime` and resource endpoints. |
| `DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN` | empty | Optional bearer token sent to Local shellctl. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_ENDPOINT` | empty | Enterprise Gateway endpoint required by configuration. Current Home Snapshot and Binding operations fail fast with `NotImplementedError`. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_AUTH_TOKEN` | empty | Optional `X-Inner-Api-Key` sent to the Enterprise Gateway. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_TIMEOUT` | `30` | Enterprise control-plane timeout in seconds. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_PROXY_TIMEOUT` | `60` | Enterprise shellctl-proxy timeout in seconds. |
| `DIFY_AGENT_E2B_API_KEY` | empty | E2B API key; required for E2B. |
| `DIFY_AGENT_E2B_TEMPLATE` | `difys-default-team/dify-agent-local-sandbox` | Prepared E2B template containing shellctl and the initial Home environment. |
| `DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS` | `3600` | Maximum continuous active time, up to 3600 seconds. Binding resources pause on timeout; temporary Home initialization resources are killed. This is not a retention TTL. |
| `DIFY_AGENT_E2B_SHELLCTL_AUTH_TOKEN` | empty | Optional bearer token expected by shellctl inside the E2B template. |
| `DIFY_AGENT_E2B_SHELLCTL_PORT` | `5004` | shellctl port exposed by the E2B template. |
| `DIFY_AGENT_SANDBOX_FILE_UPLOAD_MAX_BYTES` | `52428800` | Standalone Dify Agent maximum for whole-file Workspace upload capture; 50 MiB by default. Docker Compose derives it from `PLUGIN_MAX_FILE_SIZE`. |
| `DIFY_AGENT_SHELL_REDACT_PATTERNS` | empty | JSON array of additional regex patterns redacted from Shell output. |
| `DIFY_AGENT_STUB_API_BASE_URL` | empty | Public Agent Stub API base URL reachable from shellctl-managed remote machines. HTTP may be the service root or `/agent-stub`; gRPC must be `grpc://host:port`. Enables `DIFY_AGENT_STUB_*` env injection for user `shell.run` jobs. |
| `DIFY_AGENT_STUB_GRPC_BIND_ADDRESS` | empty | Optional `host:port` bind override used only when `DIFY_AGENT_STUB_API_BASE_URL` uses `grpc://`. |
| `DIFY_AGENT_SERVER_SECRET_KEY` | empty | Security-sensitive server-wide root secret used to derive the JWE encryption key for Agent Stub bearer tokens; required when `DIFY_AGENT_STUB_API_BASE_URL` is set. The supplied default config uses a development value; set a unique unpadded base64url 32-byte secret in production. |
| `DIFY_AGENT_OUTBOUND_HTTP_CONNECT_TIMEOUT` | `10` | Shared outbound HTTP connect timeout in seconds. |
| `DIFY_AGENT_OUTBOUND_HTTP_READ_TIMEOUT` | `600` | Shared outbound HTTP read timeout in seconds. |
| `DIFY_AGENT_OUTBOUND_HTTP_WRITE_TIMEOUT` | `30` | Shared outbound HTTP write timeout in seconds. |
| `DIFY_AGENT_OUTBOUND_HTTP_POOL_TIMEOUT` | `10` | Shared outbound connection-pool wait timeout in seconds. |
| `DIFY_AGENT_OUTBOUND_HTTP_MAX_CONNECTIONS` | `100` | Maximum total shared outbound HTTP connections. |
| `DIFY_AGENT_OUTBOUND_HTTP_MAX_KEEPALIVE_CONNECTIONS` | `20` | Maximum idle shared outbound HTTP connections. |
| `DIFY_AGENT_OUTBOUND_HTTP_KEEPALIVE_EXPIRY` | `30` | Idle keep-alive expiry in seconds. |

Example `.env`:

```env
DIFY_AGENT_REDIS_URL=redis://localhost:6379/0
DIFY_AGENT_REDIS_PREFIX=dify-agent-dev
DIFY_AGENT_SHUTDOWN_GRACE_SECONDS=30
DIFY_AGENT_RUN_RETENTION_SECONDS=259200
DIFY_AGENT_PLUGIN_DAEMON_URL=http://localhost:5002
DIFY_AGENT_PLUGIN_DAEMON_API_KEY=replace-with-daemon-key
DIFY_AGENT_INNER_API_URL=http://localhost:5001
DIFY_AGENT_INNER_API_KEY=replace-with-dify-inner-api-key-for-plugin
DIFY_AGENT_RUNTIME_BACKEND=local
DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT=http://127.0.0.1:5004
DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=replace-with-shellctl-token
DIFY_AGENT_SANDBOX_FILE_UPLOAD_MAX_BYTES=52428800
DIFY_AGENT_STUB_API_BASE_URL=https://agent.example.com/agent-stub
# This is security-sensitive: it derives the JWE encryption key for Agent Stub bearer tokens.
# Replace this development default in production.
# Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(32))'
DIFY_AGENT_SERVER_SECRET_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY
```

`DIFY_AGENT_SHELLCTL_ENTRYPOINT` and `DIFY_AGENT_SHELLCTL_AUTH_TOKEN` remain
accepted only as legacy aliases for the two Local settings. New deployments
must use `DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT` and
`DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN`. There is no compatibility setting for
the removed shell-provider selector or Shell-owned Home root.

The example above is for a standalone Dify Agent process, where the byte limit
can be set directly. In a Docker deployment, set `PLUGIN_MAX_FILE_SIZE` in
`docker/.env`; Compose maps it to
`DIFY_AGENT_SANDBOX_FILE_UPLOAD_MAX_BYTES` inside `agent_backend`.

The backend selection is deployment-private. Shell-enabled run requests use an
Execution Context, `dify.runtime`, and `dify.shell` graph. Runtime config carries
only the opaque `backend_binding_ref` resolved by Dify API. See
[Runtime resources](../concepts/runtime-resources/index.md) for the ownership
and lifecycle contract.

Run records and event streams use the same retention. Status writes refresh the
record TTL, and event writes refresh both the stream TTL and the corresponding
record TTL so active runs that keep producing events remain observable.

## Validate the E2B Compose deployment

The E2B overlay requires a prepared template that starts shellctl on port 5004.
The default is `difys-default-team/dify-agent-local-sandbox`. It also requires
an E2B API key in `DIFY_AGENT_E2B_API_KEY`; the Compose interpolation accepts
`E2B_API_KEY` and `E2B_API_TOKEN` only as deployment-level fallbacks.

From the repository root, keep the normal `docker/.env` unchanged and export the
secret for this shell:

```bash
export DIFY_AGENT_E2B_API_KEY="${DIFY_AGENT_E2B_API_KEY:-${E2B_API_KEY:-${E2B_API_TOKEN:-}}}"
test -n "$DIFY_AGENT_E2B_API_KEY"
export DIFY_AGENT_E2B_TEMPLATE=difys-default-team/dify-agent-local-sandbox

docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.e2b.yaml \
  up -d --build
```

The overlay builds `dify-api:e2b-local` and
`dify-agent-backend:e2b-local` from the current checkout. It disables the
normal Local sandbox service, switches Dify Agent to E2B, and mounts PostgreSQL
on the separate `dify_e2b_postgres_data` Compose volume. That database is empty
when the volume is first created and is isolated from the normal stack; later
starts reuse it until an operator explicitly removes the volume.

Verify the merged deployment and the branch-built Dify Agent API:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.e2b.yaml \
  ps

agent_backend_port="$(
  docker compose \
    --env-file docker/.env \
    -f docker/docker-compose.yaml \
    -f docker/docker-compose.e2b.yaml \
    port agent_backend 5050 | awk -F: 'NR == 1 { print $NF }'
)"
test -n "$agent_backend_port"
curl --fail --silent --show-error \
  --connect-timeout 2 --max-time 5 \
  --retry 12 --retry-delay 1 --retry-connrefused --retry-max-time 60 \
  "http://127.0.0.1:${agent_backend_port}/openapi.json" \
  >/dev/null

docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.e2b.yaml \
  logs --tail=100 agent_backend api worker
```

Stop the validation stack without deleting its isolated database volume:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.e2b.yaml \
  down
```

`DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS` controls continuous active E2B time.
The physical resource behind a Binding pauses when that timeout fires; a
temporary Home initialization resource is killed. Pausing preserves the current
Workspace. The setting does not delete an aged paused resource or immutable
snapshot, and Dify Agent currently has no resource-age TTL, reconciler, or
eventual cleanup guarantee. Dify API retirement followed by Binding collection
kills the coupled E2B resource.

## Run runtime-backend integration contracts

Run the disposable Local contract from the `dify-agent` directory. The script
starts one local-sandbox container on an unused port and removes that exact
container on exit:

```bash
cd dify-agent
DIFY_AGENT_TEST_LOCAL_SANDBOX_IMAGE=langgenius/dify-agent-local-sandbox:1.16.0 \
  tests/integration/dify_agent/runtime_backend/run_local_integration.sh
```

To use an already managed Local shellctl endpoint instead:

```bash
cd dify-agent
DIFY_AGENT_TEST_LOCAL_SHELLCTL_ENDPOINT=http://127.0.0.1:5004 \
DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN=replace-with-shellctl-token \
  pdm run pytest --import-mode=importlib \
  tests/integration/dify_agent/runtime_backend/test_working_environment.py \
  -k local -q -rs
```

Run the real E2B contract with an explicit test credential and template:

```bash
cd dify-agent
DIFY_AGENT_TEST_E2B_API_KEY="$E2B_API_TOKEN" \
DIFY_AGENT_TEST_E2B_TEMPLATE=difys-default-team/dify-agent-local-sandbox \
DIFY_AGENT_TEST_E2B_ACTIVE_TIMEOUT_SECONDS=900 \
  pdm run pytest --import-mode=importlib \
  tests/integration/dify_agent/runtime_backend/test_working_environment.py \
  -k e2b -q -rs
```

The Local auth token is optional when shellctl has authentication disabled.
The E2B test timeout value `900` means up to 15 minutes of continuous active
test time; it is not a post-test retention TTL. Both contracts create unique
resources and perform explicit cleanup in `finally` blocks.

## Scheduling and shutdown semantics

`POST /runs` persists a `running` run record and starts an `asyncio` task in the
same process. There is no Redis job stream, consumer group, pending reclaim, or
automatic retry layer. Request-shaped runtime failures such as bad composition,
prompt, output, or snapshot inputs are reported later as failed runs rather than
rejected synchronously once the request DTO itself is accepted.

During FastAPI shutdown the scheduler rejects new runs, waits up to
`DIFY_AGENT_SHUTDOWN_GRACE_SECONDS` for active tasks, then cancels remaining tasks
and best-effort appends a `run_failed` event plus failed status. A hard process
crash can still leave active runs stuck as `running`; there is no in-service
recovery or worker handoff.

Horizontal scaling is possible by running multiple API processes against the same
Redis prefix, but each process executes only the runs it accepted. Redis provides
shared status/event visibility, not load balancing or queued-job recovery.

## Run inputs and session snapshots

The API does not accept a top-level `user_prompt`. Submit a `RunComposition`
whose Agenton layers provide user input. With the MVP provider set, use
`plain.prompt` and its `config.user` field:

```json
{
  "composition": {
    "schema_version": 1,
    "layers": [
      {
        "name": "prompt",
        "type": "plain.prompt",
        "config": {
          "prefix": "You are concise.",
          "user": "Summarize the current state."
        }
      }
    ]
  }
}
```

`config.user` can be a string or a list of strings. Empty or whitespace-only
effective prompts are rejected during create-run validation before the run is
persisted or scheduled.

There is no Pydantic AI history layer. To resume Agenton layer state, pass the
`session_snapshot` from a previous `run_succeeded.data` payload together with a
composition that has the same layer names and order.

## Observing runs

Use the HTTP status endpoint for coarse state and the event endpoints for detailed
progress:

- `POST /runs` creates a running run and schedules it locally.
- `GET /runs/{run_id}` returns `running`, `succeeded`, or `failed`.
- `GET /runs/{run_id}/events` polls the Redis Stream event log with `after` and
  `next_cursor` cursors.
- `GET /runs/{run_id}/events/sse` replays and streams events over SSE. The SSE
  `id` is the event Redis Stream ID. `after` query cursors take precedence over
  `Last-Event-ID` headers.

Successful runs emit `run_started`, zero or more `pydantic_ai_event`, and
`run_succeeded`. Failed runs end with `run_failed`. Event envelopes retain `id`,
`run_id`, `type`, `data`, and `created_at`; `data` is typed per event type,
including Pydantic AI's `AgentStreamEvent` payload for `pydantic_ai_event` and a
terminal `run_succeeded.data` object containing a `CompositorSessionSnapshot` for
resumption. A successful run has exactly one active result branch: JSON-safe
`output` for final answers, or `deferred_tool_call` when a layer such as
`dify.ask_human` ends the current agent run with an external deferred tool call.

## Examples

The repository includes simple consumers that print observed output/events:

- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_consumer.py`
  creates a run and polls events.
- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_sse_consumer.py`
  consumes raw SSE frames for an existing run id.

The create-run examples submit Dify plugin model layers, so they require Redis,
the API server, plugin-daemon settings, and provider credentials.
