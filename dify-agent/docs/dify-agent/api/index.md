# Dify Agent Run API

The Dify Agent API exposes asynchronous agent runs backed by Agenton state-only
layer composition, Pydantic AI runtime execution, Redis run records, and per-run
Redis Streams event logs. The FastAPI application lives at
`dify-agent/src/dify_agent/server/app.py`.

Public Python DTOs and event models are exported from
`dify_agent.protocol.schemas`. `dify_agent.server.schemas` is intentionally
server-only and should not be used by API consumers.

## Input model

Create-run requests accept a public `RunComposition` and an optional
`CompositorSessionSnapshot`. There is **no top-level `user_prompt` or model
profile field**. User input and model/provider selection are supplied by Agenton
layers. `on_exit` optionally controls whether layers suspend or delete when the
run leaves the active session; the default is suspend for all layers. In the MVP
server, the safe provider set includes `plain.prompt`, `dify.plugin`, and
`dify.plugin.llm`. The runtime reads the LLM model layer named by
`DIFY_AGENT_MODEL_LAYER_ID`, whose public value is `"llm"`.

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
  "composition": {
    "schema_version": 1,
    "layers": [
      {
        "name": "prompt",
        "type": "plain.prompt",
        "config": {
          "prefix": "You are a concise assistant.",
          "user": "Say hello from the Dify Agent API."
        }
      },
      {
        "name": "plugin",
        "type": "dify.plugin",
        "config": {
          "tenant_id": "replace-with-tenant-id",
          "plugin_id": "langgenius/openai"
        }
      },
      {
        "name": "llm",
        "type": "dify.plugin.llm",
        "deps": {
          "plugin": "plugin"
        },
        "config": {
          "model_provider": "openai",
          "model": "gpt-4o-mini",
          "credentials": {
            "api_key": "replace-with-provider-key"
          },
          "model_settings": {
            "temperature": 0.2
          }
        }
      }
    ]
  },
  "session_snapshot": null,
  "on_exit": {
    "default": "suspend",
    "layers": {
      "prompt": "delete"
    }
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

`dify.plugin` receives tenant/plugin identity only; daemon URL, API key, timeout,
and connection limits are server settings. `dify.plugin.llm.credentials` accepts
scalar values only (`string`, `number`, `boolean`, or `null`). Unknown
`on_exit.layers` keys return `422` before a run record is created.

Validation error example (`422`):

```json
{
  "detail": "run.user_prompts must not be empty"
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

## Python client

Use `dify_agent.client.Client` for both async and sync code. Async methods use
normal names; sync methods add `_sync`.

```python {test="skip" lint="skip"}
from agenton.layers import ExitIntent
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.dify_plugin import DifyPluginLLMLayerConfig, DifyPluginLayerConfig
from dify_agent.protocol import (
    DIFY_AGENT_MODEL_LAYER_ID,
    CreateRunRequest,
    LayerExitSignals,
    RunComposition,
    RunLayerSpec,
)


async def main() -> None:
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user="hello")),
                RunLayerSpec(
                    name="plugin",
                    type="dify.plugin",
                    config=DifyPluginLayerConfig(tenant_id="tenant-id", plugin_id="langgenius/openai"),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"plugin": "plugin"},
                    config=DifyPluginLLMLayerConfig(
                        model_provider="openai",
                        model="gpt-4o-mini",
                        credentials={"api_key": "provider-key"},
                    ),
                ),
            ]
        ),
        on_exit=LayerExitSignals(layers={"prompt": ExitIntent.DELETE}),
    )
    async with Client(base_url="http://localhost:8000") as client:
        run = await client.create_run(request)
        async for event in client.stream_events(run.run_id):
            print(event)
```

```python {test="skip" lint="skip"}
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.dify_plugin import DifyPluginLLMLayerConfig, DifyPluginLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest, RunComposition, RunLayerSpec


request = CreateRunRequest(
    composition=RunComposition(
        layers=[
            RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user="hello")),
            RunLayerSpec(
                name="plugin",
                type="dify.plugin",
                config=DifyPluginLayerConfig(tenant_id="tenant-id", plugin_id="langgenius/openai"),
            ),
            RunLayerSpec(
                name=DIFY_AGENT_MODEL_LAYER_ID,
                type="dify.plugin.llm",
                deps={"plugin": "plugin"},
                config=DifyPluginLLMLayerConfig(
                    model_provider="openai",
                    model="gpt-4o-mini",
                    credentials={"api_key": "provider-key"},
                ),
            ),
        ]
    )
)

with Client(base_url="http://localhost:8000") as client:
    run = client.create_run_sync(request)
    terminal = client.wait_run_sync(run.run_id)
```

`stream_events` and `stream_events_sync` parse SSE without an extra dependency.
They reconnect by default from the latest yielded event id and stop after
`run_succeeded` or `run_failed`. They do not reconnect for HTTP 4xx responses,
DTO validation failures, or malformed SSE frames. `create_run` and
`create_run_sync` require a `CreateRunRequest` DTO and never retry `POST /runs`;
if a timeout occurs, the caller must decide whether to inspect existing runs or
submit a new run.

## Event types and order

A normal successful run emits:

1. `run_started`
2. zero or more `pydantic_ai_event`
3. `run_succeeded`

A failed run emits:

1. `run_started`
2. zero or more `pydantic_ai_event`
3. `run_failed`

Each event keeps the same envelope shape and has typed `data`: `run_started` uses
`{}`, `pydantic_ai_event` uses Pydantic AI's `AgentStreamEvent` union,
`run_succeeded` uses `{ "output": JsonValue, "session_snapshot":
CompositorSessionSnapshot }`, and `run_failed` uses `{ "error": string,
"reason": string | null }`. The session snapshot from `run_succeeded.data` can
be sent as `session_snapshot` in a later create-run request with the same
composition layer names and order.

## Consumer examples

See:

- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_consumer.py` for cursor polling
- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_sse_consumer.py` for SSE consumption
- `dify-agent/examples/dify_agent/dify_agent_examples/run_server_sync_client.py` for synchronous client usage
