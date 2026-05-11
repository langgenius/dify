# Dify Agent Run API

The Dify Agent API exposes asynchronous agent runs backed by Agenton compositor
configuration, Pydantic AI runtime execution, Redis run records, and per-run Redis
Streams event logs. The FastAPI application lives at
`dify-agent/src/dify_agent/server/app.py`.

## Input model

Create-run requests accept a `CompositorConfig` and an optional
`CompositorSessionSnapshot`. There is **no top-level `user_prompt` field**.
User input must be supplied by Agenton layers. In the MVP server, the safe
config-constructible layer registry includes `plain.prompt`; its `config.user`
field becomes `Compositor.user_prompts` and is passed to Pydantic AI as the run
input.

Blank user input is rejected. A request with no user prompt, an empty string, or
only whitespace strings such as `"user": ["", "   "]` returns `422` before a run
record is created.

The server does not implement a Pydantic AI history layer. Resumable Agenton
state is represented only by `session_snapshot`.

## Create a run

```http
POST /runs
Content-Type: application/json
```

Request:

```json
{
  "compositor": {
    "schema_version": 1,
    "layers": [
      {
        "name": "prompt",
        "type": "plain.prompt",
        "config": {
          "prefix": "You are a concise assistant.",
          "user": "Say hello from the Dify Agent API."
        }
      }
    ]
  },
  "session_snapshot": null,
  "agent_profile": {
    "provider": "test",
    "output_text": "Hello from the TestModel."
  }
}
```

Response (`202 Accepted`):

```json
{
  "run_id": "4a7f9a98-5c55-48d0-8f3e-87ef2cf81234",
  "status": "running"
}
```

The server persists the run record and schedules execution immediately in the
same FastAPI process. Redis is not used as a job queue. Run records and per-run
event streams expire after `DIFY_AGENT_RUN_RETENTION_SECONDS`, which defaults to
`259200` seconds (3 days).

`agent_profile.provider` currently supports the credential-free `test` profile.

Validation error example (`422`):

```json
{
  "detail": "compositor.user_prompts must not be empty"
}
```

## Get run status

```http
GET /runs/{run_id}
```

Response:

```json
{
  "run_id": "4a7f9a98-5c55-48d0-8f3e-87ef2cf81234",
  "status": "succeeded",
  "created_at": "2026-05-08T12:00:00Z",
  "updated_at": "2026-05-08T12:00:02Z",
  "error": null
}
```

Status values are:

- `running`
- `succeeded`
- `failed`

Unknown or expired run ids return `404` with `"run not found"`.

## Poll events

```http
GET /runs/{run_id}/events?after=0-0&limit=100
```

Cursor values are Redis Stream IDs. Use `after=0-0` to read from the beginning.
The response includes `next_cursor`; pass it as the next `after` value to continue
polling.

Response:

```json
{
  "run_id": "4a7f9a98-5c55-48d0-8f3e-87ef2cf81234",
  "events": [
    {
      "id": "1715170000000-0",
      "run_id": "4a7f9a98-5c55-48d0-8f3e-87ef2cf81234",
      "type": "run_started",
      "data": {},
      "created_at": "2026-05-08T12:00:00Z"
    }
  ],
  "next_cursor": "1715170000000-0"
}
```

## Stream events with SSE

```http
GET /runs/{run_id}/events/sse
```

SSE frames use the run event id as `id`, the event type as `event`, and the full
`RunEvent` JSON object as `data`:

```text
id: 1715170000000-0
event: run_started
data: {"id":"1715170000000-0","run_id":"...","type":"run_started","data":{},"created_at":"..."}

```

Replay can start from a cursor with either:

- `GET /runs/{run_id}/events/sse?after=1715170000000-0`
- `Last-Event-ID: 1715170000000-0`

If both are provided, the `after` query parameter takes precedence.

## Event types and order

A normal successful run emits:

1. `run_started`
2. zero or more `pydantic_ai_event`
3. `agent_output`
4. `session_snapshot`
5. `run_succeeded`

A failed run emits:

1. `run_started`
2. zero or more `pydantic_ai_event`
3. `run_failed`

Each event keeps the same envelope shape and has typed `data`: `run_started` and
`run_succeeded` use `{}`, `pydantic_ai_event` uses Pydantic AI's
`AgentStreamEvent` union, `agent_output` uses `{ "output": string }`,
`session_snapshot` uses `CompositorSessionSnapshot`, and `run_failed` uses
`{ "error": string, "reason": string | null }`. The session snapshot can be sent
as `session_snapshot` in a later create-run request with the same compositor layer
names and order.

## Consumer examples

See:

- `dify-agent/examples/run_server_consumer.py` for cursor polling
- `dify-agent/examples/run_server_sse_consumer.py` for SSE consumption
