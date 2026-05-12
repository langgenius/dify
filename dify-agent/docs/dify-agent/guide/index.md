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
- one shared plugin-daemon `httpx.AsyncClient` used by local run tasks
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
| `DIFY_AGENT_PLUGIN_DAEMON_CONNECT_TIMEOUT` | `10` | Plugin-daemon HTTP connect timeout in seconds. |
| `DIFY_AGENT_PLUGIN_DAEMON_READ_TIMEOUT` | `600` | Plugin-daemon HTTP read timeout in seconds. |
| `DIFY_AGENT_PLUGIN_DAEMON_WRITE_TIMEOUT` | `30` | Plugin-daemon HTTP write timeout in seconds. |
| `DIFY_AGENT_PLUGIN_DAEMON_POOL_TIMEOUT` | `10` | Plugin-daemon HTTP connection-pool wait timeout in seconds. |
| `DIFY_AGENT_PLUGIN_DAEMON_MAX_CONNECTIONS` | `100` | Maximum total plugin-daemon HTTP connections. |
| `DIFY_AGENT_PLUGIN_DAEMON_MAX_KEEPALIVE_CONNECTIONS` | `20` | Maximum idle keep-alive plugin-daemon HTTP connections. |
| `DIFY_AGENT_PLUGIN_DAEMON_KEEPALIVE_EXPIRY` | `30` | Keep-alive expiry in seconds for idle plugin-daemon HTTP connections. |

Example `.env`:

```env
DIFY_AGENT_REDIS_URL=redis://localhost:6379/0
DIFY_AGENT_REDIS_PREFIX=dify-agent-dev
DIFY_AGENT_SHUTDOWN_GRACE_SECONDS=30
DIFY_AGENT_RUN_RETENTION_SECONDS=259200
DIFY_AGENT_PLUGIN_DAEMON_URL=http://localhost:5002
DIFY_AGENT_PLUGIN_DAEMON_API_KEY=replace-with-daemon-key
```

Run records and event streams use the same retention. Status writes refresh the
record TTL, and event writes refresh both the stream TTL and the corresponding
record TTL so active runs that keep producing events remain observable.

## Scheduling and shutdown semantics

`POST /runs` validates the composition, persists a `running` run record, and starts
an `asyncio` task in the same process. There is no Redis job stream, consumer
group, pending reclaim, or automatic retry layer.

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
terminal `run_succeeded.data` object containing JSON-safe `output` plus a
`CompositorSessionSnapshot` for resumption.

## Examples

The repository includes simple consumers that print observed output/events:

- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_consumer.py`
  creates a run and polls events.
- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_sse_consumer.py`
  consumes raw SSE frames for an existing run id.

The create-run examples submit Dify plugin model layers, so they require Redis,
the API server, plugin-daemon settings, and provider credentials.
