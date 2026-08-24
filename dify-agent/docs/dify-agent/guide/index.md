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
| `DIFY_AGENT_RUN_TIMEOUT_SECONDS` | `3600` | Wall-clock deadline in seconds for the Pydantic AI `agent.run(...)` model/tool loop. Deadline failures use `agent_run_limit_exceeded`. Its default intentionally matches `DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS`, but the settings are independently configurable. |
| `DIFY_AGENT_BINDING_FILE_DOWNLOAD_COMMAND_TIMEOUT_SECONDS` | `210` | Shell command deadline for running the sandbox `dify-agent file upload --no-download-link` conversion. Keep it above the CLI's 180-second upload deadline. |
| `DIFY_AGENT_API_TOKEN` | empty | Optional Bearer token required by private run, Execution Binding, Home Snapshot, and Binding file control-plane routes. Must match Dify API `AGENT_BACKEND_API_TOKEN`. |
| `DIFY_AGENT_PLUGIN_DAEMON_URL` | `http://localhost:5002` | Base URL for the Dify plugin daemon. |
| `DIFY_AGENT_PLUGIN_DAEMON_API_KEY` | empty | API key sent to the Dify plugin daemon. |
| `DIFY_AGENT_INNER_API_URL` | `http://localhost:5001` | Dify API service root used when dify-agent calls `/inner/api/...` endpoints. |
| `DIFY_AGENT_INNER_API_KEY` | empty | API key sent to Dify API inner plugin endpoints. Set this to Dify API `INNER_API_KEY_FOR_PLUGIN` (Docker: `PLUGIN_DIFY_INNER_API_KEY`). |
| `DIFY_AGENT_RUNTIME_BACKEND` | `local` | Selects one coherent `local`, `enterprise`, or `e2b` Home Snapshot + Execution Binding backend profile. |
| `DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT` | empty | Local shellctl data-plane URL. With the default Local selection, leaving it empty disables `dify.runtime` and resource endpoints. |
| `DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN` | empty | Optional bearer token sent to Local shellctl. |
| `DIFY_AGENT_LOCAL_SANDBOX_MATERIALIZED_HOME_ROOT` | `/home/dify` | Root directory, on the Local shellctl filesystem, for per-Binding materialized Homes. |
| `DIFY_AGENT_LOCAL_SANDBOX_WORKSPACE_ROOT` | `/workspace` | Root directory, on the Local shellctl filesystem, for mutable Workspaces. |
| `DIFY_AGENT_LOCAL_SANDBOX_HOME_SNAPSHOT_ROOT` | `/home/dify/.snapshots` | Root directory, on the Local shellctl filesystem, for immutable Home Snapshots. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_ENDPOINT` | empty | Enterprise Gateway endpoint required by configuration. Default-Home Bindings are supported; immutable Home Snapshot operations remain unsupported. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_AUTH_TOKEN` | empty | Optional `X-Inner-Api-Key` sent to the Enterprise Gateway. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_TIMEOUT` | `30` | Enterprise control-plane timeout in seconds. |
| `DIFY_AGENT_ENTERPRISE_SANDBOX_PROXY_TIMEOUT` | `60` | Enterprise shellctl-proxy timeout in seconds. |
| `DIFY_AGENT_E2B_API_KEY` | empty | E2B API key; required for E2B. |
| `DIFY_AGENT_E2B_TEMPLATE` | `difys-default-team/dify-agent-local-sandbox` | Prepared E2B template containing shellctl and the deployment-default Home environment. |
| `DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS` | `3600` | Maximum continuous active time for the RuntimeLease spanning one complete Agent run. Its default intentionally matches `DIFY_AGENT_RUN_TIMEOUT_SECONDS`, but the settings are independently configurable. Binding resources pause on timeout; this setting does not own the run terminal state and is not a retention TTL. |
| `DIFY_AGENT_E2B_SHELLCTL_PORT` | `5004` | shellctl port exposed by the E2B template. |
| `DIFY_AGENT_SHELL_REDACT_PATTERNS` | empty | JSON array of additional regex patterns redacted from Shell output. |
| `DIFY_AGENT_STUB_API_BASE_URL` | empty | HTTP(S) Agent Stub API base URL reachable from the Sandbox. It may be the service root or `/agent-stub`. Enables `DIFY_AGENT_STUB_*` env injection for user `shell.run` jobs. |
| `DIFY_AGENT_SANDBOX_FILES_BASE_URL` | empty | Dify API base URL reachable from the Sandbox for signed `/files/*` upload/download bytes, including Config file and skill pulls. Required when Agent Stub file operations are enabled. May include an ingress path prefix, but not a query or fragment. |
| `DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT` | `50` | Agent service-owned maximum Agent Stub upload size in MiB. The file-request handler factory converts it to bytes and sends it to Dify API as the required `max_size` used to sign a size-limited upload URL. |
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
DIFY_AGENT_RUN_TIMEOUT_SECONDS=3600
DIFY_AGENT_API_TOKEN=replace-with-agent-backend-token
DIFY_AGENT_PLUGIN_DAEMON_URL=http://localhost:5002
DIFY_AGENT_PLUGIN_DAEMON_API_KEY=replace-with-daemon-key
DIFY_AGENT_INNER_API_URL=http://localhost:5001
DIFY_AGENT_INNER_API_KEY=replace-with-dify-inner-api-key-for-plugin
DIFY_AGENT_RUNTIME_BACKEND=local
DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT=http://127.0.0.1:5004
DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN=replace-with-shellctl-token
# Set these when shellctl runs directly on a host that does not have /home/dify.
DIFY_AGENT_LOCAL_SANDBOX_MATERIALIZED_HOME_ROOT=/tmp/dify-agent/materialized-homes
DIFY_AGENT_LOCAL_SANDBOX_WORKSPACE_ROOT=/tmp/dify-agent/workspaces
DIFY_AGENT_LOCAL_SANDBOX_HOME_SNAPSHOT_ROOT=/tmp/dify-agent/home-snapshots
DIFY_AGENT_STUB_API_BASE_URL=https://agent.example.com/agent-stub
DIFY_AGENT_SANDBOX_FILES_BASE_URL=https://dify.example.com
DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT=50
# This is security-sensitive: it derives the JWE encryption key for Agent Stub bearer tokens.
# Replace this development default in production.
# Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(32))'
DIFY_AGENT_SERVER_SECRET_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY
```

The two Sandbox-facing base URLs have different owners. Agent Stub control
requests use `DIFY_AGENT_STUB_API_BASE_URL`; signed file bytes use
`DIFY_AGENT_SANDBOX_FILES_BASE_URL`. `DIFY_AGENT_INNER_API_URL` remains a
trusted service-to-service URL and is never returned to the Sandbox.

Config file and skill pulls use the same split: Agent Stub authorizes the
Config target and returns a short-lived URL, then the Sandbox fetches the bytes
directly from the Dify API `/files/*` data plane.

Removing Agent Stub gRPC is a breaking transport migration: replace every
`grpc://` Agent Stub URL with HTTP(S), remove
`DIFY_AGENT_STUB_GRPC_BIND_ADDRESS`, and deploy without a gRPC fallback.

For a remote Sandbox, expose only `/agent-stub/*` from Agent Backend and the
existing `/files/*` Dify API data plane. The `/files/*` ingress must preserve
the complete signed query string and set its request-body limit above the
configured file-size limit to leave room for multipart framing and headers; the
two limits need not be numerically equal. Use response streaming and timeouts
suitable for large downloads. Do not expose Agent Backend `/runs`, Workspace,
or Binding management routes through the Sandbox ingress.

Browser presentation URLs are independent. Configure Dify API `FILES_URL` to a
browser-reachable public origin, or leave it empty so responses use same-origin
relative `/files/...` URIs. Never set `FILES_URL` to a Docker-only service name
such as `http://api:5001`.

`DIFY_AGENT_SHELLCTL_ENTRYPOINT` and `DIFY_AGENT_SHELLCTL_AUTH_TOKEN` remain
accepted only as legacy aliases for the two Local settings. New deployments
must use `DIFY_AGENT_LOCAL_SANDBOX_ENDPOINT` and
`DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN`. There is no compatibility setting for
the removed shell-provider selector.

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
The physical resource behind a Binding pauses when that timeout fires, preserving
the current Workspace. The setting is not a resource-age TTL, does not delete
paused resources or immutable snapshots, and does not authoritatively finalize
the Agent run. If the paused Sandbox is first observed by a Shell tool, that
provider failure is returned to Pydantic AI as a tool error observation.

The run and E2B defaults both equal 3600 seconds, but independent clocks and
asynchronous E2B pause propagation make their ordering nondeterministic. A Shell
provider `RuntimeError` observed first becomes a tool observation. In contrast,
run-deadline cancellation propagates through the Shell boundary; only the Dify
Agent run deadline owns the terminal `agent_run_limit_exceeded` failure.

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
  pdm run pytest --import-mode=importlib \
  tests/integration/dify_agent/runtime_backend/test_working_environment.py \
  -k e2b -q -rs
```

The Local auth token is optional when shellctl has authentication disabled.
The E2B contract uses the one-hour `E2B_MAX_ACTIVE_TIMEOUT_SECONDS` RuntimeLease
limit. This is continuous active test time, not a post-test retention TTL. Both
contracts create unique resources and perform explicit cleanup in `finally`
blocks.

## Scheduling and shutdown semantics

`POST /runs` persists a `running` run record and starts an `asyncio` task in the
same process. There is no Redis job stream, consumer group, pending reclaim, or
automatic retry layer. Request-shaped runtime failures such as bad composition,
prompt, output, or snapshot inputs are reported later as failed runs rather than
rejected synchronously once the request DTO itself is accepted.

Each run explicitly limits Pydantic AI to 500 model-request steps. Tool calls do
not have a separate count limit, but every model request used to continue the
tool loop consumes one of those steps.

`DIFY_AGENT_RUN_TIMEOUT_SECONDS` additionally applies a wall-clock deadline only
around Pydantic AI's `agent.run(...)`, including its model/tool loop and event
handler. It does not include compositor entry, RuntimeLease acquisition, tool
preparation, session snapshot generation, or resource exit. Expiry cancels the
active run task, allows the compositor to release resources, and finalizes the
run as failed with `error_type: "agent_run_limit_exceeded"`.

During FastAPI shutdown the scheduler rejects new runs, waits up to
`DIFY_AGENT_SHUTDOWN_GRACE_SECONDS` for active tasks, then cancels remaining tasks
and attempts to finalize them as failed. Success and failure use an atomic Redis
transition. Cancellation first atomically records a private intent; after the
owner exits the runner, a second atomic transition appends `run_cancelled`,
updates the run record, and deletes the intent. The first accepted success,
failure, or cancellation intent wins. A hard process crash can still leave
active runs, including runs with accepted cancellation intent, stuck as
`running`; there is no in-service recovery or worker handoff.

Horizontal scaling is possible by running multiple API processes against the same
Redis prefix, but each process executes only the runs it accepted. Redis provides
shared status/event visibility, not load balancing or queued-job recovery. The
cancel endpoint can atomically accept a running run on any process. The process
that owns the runner observes the private cancellation-intent stream, cancels
and cleans up its local task, and only then emits `run_cancelled`. The HTTP
response confirms that cancellation intent is durable; `GET /runs/{run_id}` may
still report `running` until cleanup finishes. Retrying an accepted or completed
cancellation is idempotent.

Atomic terminal finalization currently assumes the configured Redis URL targets
one Redis deployment that can execute all run-coordination keys in a Lua script.
The record and event key names are unchanged, and cancellation adds a private
cancel-intent key. These keys do not contain a shared Redis Cluster hash tag, so
Redis Cluster is not supported for this transition. During
a rolling upgrade, older processes can still use the former split event/status
writes; treat the single-terminal invariant as active only after those processes
have exited. Deploy atomic terminal finalization everywhere first, then ensure
every process that can own a runner has the cancellation observer before relying
on route-independent cancellation. Operators should then alert on more than one
terminal event per run and on disagreement between the run record status and
terminal event type.

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

The optional Pydantic AI history layer uses the reserved name `history` and
persists captured messages in session snapshots for later resume. Resume from a
terminal event's `session_snapshot` using the same layer composition, names, and
order. Success always contains a snapshot. Failure and cancellation contain one
only when compositor entry succeeded and layer exit completed; otherwise callers
should retain their previous snapshot.

## Observing runs

Use the HTTP status endpoint for coarse state and the event endpoints for detailed
progress:

- `POST /runs` creates a running run and schedules it locally.
- `GET /runs/{run_id}` returns `running`, `succeeded`, `failed`, or `cancelled`.
  Failed records can also expose a stable machine-readable `error_type` alongside
  the diagnostic `error` text.
- `POST /runs/{run_id}/cancel` atomically accepts cancellation on any API process
  and returns immediately. `CancelRunResponse.status == "cancelled"` acknowledges
  a durably accepted cancellation intent, not completed runner cleanup. Callers
  that require cleanup-complete state or its session snapshot must await the
  public `run_cancelled` event or use `cancel_run_and_wait`. The endpoint returns
  `409` only when a success/failure terminal already won.
- `GET /runs/{run_id}/events` polls the Redis Stream event log with `after` and
  `next_cursor` cursors.
- `GET /runs/{run_id}/events/sse` replays and streams events over SSE. The SSE
  `id` is the event Redis Stream ID. `after` query cursors take precedence over
  `Last-Event-ID` headers. The server closes the SSE response normally after
  delivering a terminal event. Clients must stop reconnecting after consuming
  that event. Both cursor forms remain exclusive resume cursors, so the server
  does not resend a terminal event that the supplied cursor already excludes.

Successful runs emit `run_started`, zero or more `pydantic_ai_event`, and
`run_succeeded`. Failed runs end with `run_failed`, and accepted cancellations
end with `run_cancelled`. Each run can append at most one of these terminal
events. Event envelopes retain `id`, `run_id`, `type`, `data`, and `created_at`;
`data` is typed per event type,
including Pydantic AI's `AgentStreamEvent` payload for `pydantic_ai_event` and a
terminal event may contain a `CompositorSessionSnapshot` for resumption.
`run_succeeded` always contains it; `run_failed` and `run_cancelled` contain it
only when compositor entry succeeded, layer exit completed, and a post-exit
snapshot was actually produced. A successful run has exactly one active result branch: JSON-safe
`output` for final answers, or `deferred_tool_call` when a layer such as
`dify.ask_human` ends the current agent run with an external deferred tool call.
Failed event payloads contain the diagnostic `error`, optional source-specific
`reason`, optional stable `error_type`, and optional `session_snapshot`.
Cancelled payloads likewise may contain `session_snapshot`. Pydantic AI request/step budget
exhaustion enforced by Dify Agent is reported as
`error_type: "agent_run_limit_exceeded"`; consumers should branch on that value
rather than parsing the error text. The Dify Agent-owned wall-clock run deadline
uses the same error type; provider and connection timeouts do not. The matching
failed run record and terminal event are committed atomically with the same error
type. For independently deployed Agent backend and API services, deploy consumers
that accept the optional field before producers begin emitting it because the
public protocol models reject unknown fields.

## Examples

The repository includes simple consumers that print observed output/events:

- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_consumer.py`
  creates a run and polls events.
- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_sse_consumer.py`
  consumes raw SSE frames for an existing run id.

The create-run examples submit Dify plugin model layers, so they require Redis,
the Agent server, Dify API gateway settings, and a configured model provider in Dify.
