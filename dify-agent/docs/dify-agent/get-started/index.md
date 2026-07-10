# Get started with Dify Agent

This guide walks through the smallest end-to-end path for the current Dify Agent
runtime: install dependencies, configure the server, start it, then use the Python
client to create one plugin-daemon-backed run.

## Prerequisites

Install or prepare:

- Python 3.12 or newer
- `uv`
- Redis
- a reachable Dify plugin daemon
- a plugin/provider already available through that plugin daemon, such as
  `langgenius/openai`

## Install dependencies

From the repository root, enter the `dify-agent` package and install all extras
and dependency groups:

```bash
cd dify-agent
uv sync --all-extras --all-groups
```

Only the `server` extra is required to run the API server, but installing all
extras and groups gives you the local test, docs, and server dependencies in one
environment.

## Start Redis

Skip this step if you already have a reachable Redis instance.

```bash
docker run -d \
  --name dify-agent-redis \
  -p 6379:6379 \
  redis:7-alpine
```

## Configure the server

Create or update `.env` in the `dify-agent` directory:

```bash
cat > .env <<'EOF'
DIFY_AGENT_REDIS_URL=redis://localhost:6379/0
DIFY_AGENT_REDIS_PREFIX=dify-agent

DIFY_AGENT_PLUGIN_DAEMON_URL=http://localhost:5002
DIFY_AGENT_PLUGIN_DAEMON_API_KEY=replace-with-plugin-daemon-server-key

DIFY_AGENT_INNER_API_URL=http://localhost:5001
DIFY_AGENT_INNER_API_KEY=replace-with-dify-inner-api-key-for-plugin
EOF
```

The minimum settings are:

- `DIFY_AGENT_REDIS_URL`: Redis connection URL used for run records and event
  streams.
- `DIFY_AGENT_REDIS_PREFIX`: Redis key prefix for this server.
- `DIFY_AGENT_PLUGIN_DAEMON_URL`: base URL for the Dify plugin daemon.
- `DIFY_AGENT_PLUGIN_DAEMON_API_KEY`: API key sent by the server to the plugin
  daemon. In a Dify Docker setup this is usually the value previously configured
  as `PLUGIN_DAEMON_KEY`.
- `DIFY_AGENT_INNER_API_URL`: Dify API service root for `/inner/api/...` calls.
- `DIFY_AGENT_INNER_API_KEY`: API key sent to Dify API inner plugin endpoints.
  In Docker this should match `PLUGIN_DIFY_INNER_API_KEY`, which maps to Dify
  API `INNER_API_KEY_FOR_PLUGIN`.

See `.example.env` for the full server settings template.

If you plan to run `dify.shell`, also configure `DIFY_AGENT_SHELLCTL_ENTRYPOINT`
and, when shell jobs need to call back with the `dify-agent` command, set
`DIFY_AGENT_STUB_API_BASE_URL`. The supplied default configs include a
development `DIFY_AGENT_SERVER_SECRET_KEY`, but production deployments should
override it with a unique 32-byte base64url value as documented in `.example.env`.

## Start the Dify Agent server

For a normal local server process:

```bash
make serve
```

For development with uvicorn reload:

```bash
make dev
```

Both commands serve the API at:

```text
http://127.0.0.1:8000
```

The equivalent development command is:

```bash
uv run --extra server uvicorn dify_agent.server.app:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload
```

`ServerSettings` reads `.env` from the current `dify-agent` directory, or from
`dify-agent/.env` when the command is run from the repository root.

## Create a Python client example

In another shell, keep working from the `dify-agent` directory. Create
`run_dify_agent_client.py` with the example below, then replace the placeholder
tenant id and provider credential values.

```python {test="skip" lint="skip"}
import asyncio
import json
import sys

from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest, RunComposition, RunLayerSpec


API_BASE_URL = "http://127.0.0.1:8000"

TENANT_ID = "replace-with-tenant-id"
PLUGIN_ID = "langgenius/openai"
USER_ID: str | None = None

# Keep these aligned with DIFY_AGENT_PROVIDER and DIFY_AGENT_MODEL_NAME in dify-agent/.env.
MODEL_PROVIDER = "replace-with-provider-from-dify-agent-env"
MODEL_NAME = "replace-with-model-from-dify-agent-env"
MODEL_CREDENTIALS: dict[str, str | int | float | bool | None] = {
    "api_key": "replace-with-provider-key",
}

SYSTEM_PROMPT = "You are a concise assistant."
USER_PROMPT = "用一句话介绍 Dify Agent。"


def build_request() -> CreateRunRequest:
    return CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    config=PromptLayerConfig(prefix=SYSTEM_PROMPT, user=USER_PROMPT),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id=TENANT_ID,
                        user_id=USER_ID,
                        invoke_from="workflow_run",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id=PLUGIN_ID,
                        model_provider=MODEL_PROVIDER,
                        model=MODEL_NAME,
                        credentials=MODEL_CREDENTIALS,
                    ),
                ),
            ],
        ),
    )


async def main() -> int:
    async with Client(base_url=API_BASE_URL, stream_timeout=None) as client:
        run = await client.create_run(build_request())
        print(f"created run: {run.run_id}, status={run.status}")

        async for event in client.stream_events(run.run_id):
            print(event.model_dump_json(indent=2))

            if event.type == "run_succeeded":
                print("final output:")
                print(json.dumps(event.data.output, ensure_ascii=False, indent=2))
                return 0

            if event.type == "run_failed":
                print(f"run failed: {event.data.error}", file=sys.stderr)
                return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
```

## Run the client example

The server-side `.env` controls how Dify Agent reaches the plugin daemon. The
client example controls which tenant/plugin/provider/model and provider
credentials the run uses.

Run the example from the `dify-agent` directory:

```bash
uv run python ./run_dify_agent_client.py
```

The shape of `MODEL_CREDENTIALS` depends on the selected plugin provider's
credential schema. The `{"api_key":"..."}` value above is only an OpenAI-style
example.

Set `MODEL_PROVIDER` and `MODEL_NAME` to the same values as
`DIFY_AGENT_PROVIDER` and `DIFY_AGENT_MODEL_NAME` in `dify-agent/.env`.

## Troubleshooting

If the run fails, check these items first:

1. Redis is running and reachable from the Dify Agent server.
2. The Dify Agent server is listening on `127.0.0.1:8000`.
3. `DIFY_AGENT_PLUGIN_DAEMON_URL` points to the correct plugin daemon.
4. `DIFY_AGENT_PLUGIN_DAEMON_API_KEY` matches the plugin daemon server key.
5. `PLUGIN_ID`, `MODEL_PROVIDER`, and `MODEL_NAME` in the client example match
   the corresponding values configured in `dify-agent/.env` and a provider
   available through the plugin daemon.
6. `MODEL_CREDENTIALS` matches that provider's credential schema.
