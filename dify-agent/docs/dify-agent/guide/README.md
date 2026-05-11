# Operating the Dify Agent Run Server

This guide describes how to run the MVP Dify Agent API server. The server is
implemented in `dify-agent/src/dify_agent/server/app.py` and uses Redis for run
records and per-run event streams only.

## Default local startup

Start Redis, then run one FastAPI/uvicorn process:

```bash
uv run --project dify-agent uvicorn dify_agent.server.app:app --reload
```

By default, the FastAPI lifespan creates both:

- one Redis-backed run store used by HTTP routes
- one process-local scheduler that starts background `asyncio` run tasks

This means local development needs one uvicorn process plus Redis. Run execution
still happens outside request handlers, so client disconnects do not cancel the
agent run.

## Configuration

`ServerSettings` loads environment variables with the `DIFY_AGENT_` prefix. It
also reads `.env` and `dify-agent/.env` when present.

| Environment variable | Default | Description |
| --- | --- | --- |
| `DIFY_AGENT_REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL. |
| `DIFY_AGENT_REDIS_PREFIX` | `dify-agent` | Prefix for Redis record and event keys. |
| `DIFY_AGENT_SHUTDOWN_GRACE_SECONDS` | `30` | Seconds to wait for active local runs during graceful shutdown before cancellation. |

Example `.env`:

```env
DIFY_AGENT_REDIS_URL=redis://localhost:6379/0
DIFY_AGENT_REDIS_PREFIX=dify-agent-dev
DIFY_AGENT_SHUTDOWN_GRACE_SECONDS=30
```

## Scheduling and shutdown semantics

`POST /runs` validates the compositor, persists a `running` run record, and starts
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

The API does not accept a top-level `user_prompt`. Submit a `CompositorConfig`
whose Agenton layers provide user input. With the MVP registry, use
`plain.prompt` and its `config.user` field:

```json
{
  "compositor": {
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
`session_snapshot` emitted by a previous run together with a compositor that has
the same layer names and order.

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

Successful runs emit `run_started`, zero or more `pydantic_ai_event`,
`agent_output`, `session_snapshot`, and `run_succeeded`. Failed runs end with
`run_failed`. Event envelopes retain `id`, `run_id`, `type`, `data`, and
`created_at`; `data` is typed per event type, including Pydantic AI's
`AgentStreamEvent` payload for `pydantic_ai_event` and `CompositorSessionSnapshot`
for `session_snapshot`.

## Examples

The repository includes simple consumers that print observed output/events:

- `dify-agent/examples/run_server_consumer.py` creates a run and polls events.
- `dify-agent/examples/run_server_sse_consumer.py` consumes raw SSE frames for an
  existing run id.

Both examples use the credential-free Pydantic AI `TestModel` profile; they still
require Redis and the API server.
