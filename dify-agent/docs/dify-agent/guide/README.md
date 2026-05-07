# Operating the Dify Agent Run Server

This guide describes how to run the MVP Dify Agent API server and worker. The
server is implemented in `dify-agent/src/dify_agent/server/app.py` and uses Redis
for run records, job queues, and event streams.

## Default local startup

Start Redis, then run one FastAPI/uvicorn process:

```bash
uv run --project dify-agent uvicorn dify_agent.server.app:app --reload
```

By default, the FastAPI lifespan creates both:

- one Redis-backed run store used by HTTP routes
- one embedded Redis Streams worker task that executes queued runs

This means local development needs one uvicorn process plus Redis. Run execution
still happens outside request handlers, so client disconnects do not cancel the
agent run.

## Configuration

`ServerSettings` loads environment variables with the `DIFY_AGENT_` prefix. It
also reads `.env` and `dify-agent/.env` when present.

| Environment variable | Default | Description |
| --- | --- | --- |
| `DIFY_AGENT_REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL. |
| `DIFY_AGENT_REDIS_PREFIX` | `dify-agent` | Prefix for Redis record, job, and event keys. |
| `DIFY_AGENT_WORKER_ENABLED` | `true` | Starts the embedded worker in the FastAPI process when true. |
| `DIFY_AGENT_WORKER_GROUP_NAME` | `run-workers` | Redis consumer group used by workers. |
| `DIFY_AGENT_WORKER_CONSUMER_NAME` | unset | Explicit consumer name. If unset, the API process uses `api-{hostname}-{pid}`; the standalone worker uses `worker-1`. |
| `DIFY_AGENT_WORKER_PENDING_IDLE_MS` | `600000` | Idle time before a pending job may be reclaimed with `XAUTOCLAIM` (10 minutes). |

Boolean settings accept Pydantic settings values such as `false`, `0`, or `no`.

Example `.env`:

```env
DIFY_AGENT_REDIS_URL=redis://localhost:6379/0
DIFY_AGENT_REDIS_PREFIX=dify-agent-dev
DIFY_AGENT_WORKER_ENABLED=true
DIFY_AGENT_WORKER_PENDING_IDLE_MS=600000
```

## Running a separate worker

For deployments that want to scale HTTP and worker processes independently,
disable the embedded worker and start a worker process separately:

```bash
DIFY_AGENT_WORKER_ENABLED=false \
  uv run --project dify-agent uvicorn dify_agent.server.app:app

uv run --project dify-agent python -m dify_agent.worker.job_worker
```

Use the same Redis URL, prefix, and worker group for the API process and all
standalone workers. Give each live worker a unique
`DIFY_AGENT_WORKER_CONSUMER_NAME` when running multiple standalone workers.

## Redis Streams reliability

Run creation stores the run record and enqueues the worker job in one Redis
transaction (`MULTI/EXEC`). A create request either persists both pieces or fails
without leaving a queued run that has no job.

Workers read jobs from a Redis Streams consumer group. If a worker crashes after
receiving a job but before acknowledging it, Redis keeps the entry pending. On
later iterations, workers call `XAUTOCLAIM` and reclaim entries idle for at least
`DIFY_AGENT_WORKER_PENDING_IDLE_MS` before reading new `>` entries. The default
idle time is `600000` milliseconds (10 minutes).

Choose the pending idle value according to your longest expected run time. A
value that is too short can cause a healthy long-running job to be reclaimed by
another worker; a value that is too long delays recovery after crashes.

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
effective prompts are rejected with `422` at the API boundary or with a runner
validation error if they reach execution.

There is no Pydantic AI history layer. To resume Agenton layer state, pass the
`session_snapshot` emitted by a previous run together with a compositor that has
the same layer names and order.

## Observing runs

Use the HTTP status endpoint for coarse state and the event endpoints for detailed
progress:

- `POST /runs` creates a queued run.
- `GET /runs/{run_id}` returns `queued`, `running`, `succeeded`, or `failed`.
- `GET /runs/{run_id}/events` polls the Redis Stream event log with `after` and
  `next_cursor` cursors.
- `GET /runs/{run_id}/events/sse` replays and streams events over SSE. The SSE
  `id` is the event Redis Stream ID. `after` query cursors take precedence over
  `Last-Event-ID` headers.

Successful runs emit `run_started`, zero or more `pydantic_ai_event`,
`agent_output`, `session_snapshot`, and `run_succeeded`. Failed runs end with
`run_failed`.

## Examples

The repository includes simple consumers that print observed output/events:

- `dify-agent/examples/run_server_consumer.py` creates a run and polls events.
- `dify-agent/examples/run_server_sse_consumer.py` consumes raw SSE frames for an
  existing run id.

Both examples use the credential-free Pydantic AI `TestModel` profile; they still
require Redis and the API server.
