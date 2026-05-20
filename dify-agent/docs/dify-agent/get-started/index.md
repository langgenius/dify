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

See `.example.env` for the full server settings template.

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

## Create a one-file uv script client

In another shell, keep working from the `dify-agent` directory and create this
script. The script depends on the local `dify-agent` package only; it does not
install the server extra because it talks to the already running server through
the public Python client.

```bash
DIFY_AGENT_PACKAGE_URL="$(python3 - <<'PY'
from pathlib import Path

print(Path.cwd().resolve().as_uri())
PY
)"

cat > ./run_dify_agent_client.py <<PY
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "dify-agent @ ${DIFY_AGENT_PACKAGE_URL}",
# ]
# ///

import asyncio
import json
import os
import sys
from typing import Any

from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LAYER_TYPE_ID,
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
    DifyPluginLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest, RunComposition, RunLayerSpec


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def load_credentials() -> dict[str, Any]:
    raw = env("DIFY_AGENT_MODEL_CREDENTIALS_JSON")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"DIFY_AGENT_MODEL_CREDENTIALS_JSON must be valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise SystemExit("DIFY_AGENT_MODEL_CREDENTIALS_JSON must be a JSON object")

    return data


async def main() -> int:
    api_base_url = env("DIFY_AGENT_SERVER_URL", "http://127.0.0.1:8000")

    tenant_id = env("DIFY_AGENT_TENANT_ID")
    plugin_id = env("DIFY_AGENT_PLUGIN_ID", "langgenius/openai")
    user_id = os.environ.get("DIFY_AGENT_USER_ID") or None

    model_provider = env("DIFY_AGENT_PROVIDER", "openai")
    model_name = env("DIFY_AGENT_MODEL_NAME", "gpt-4o-mini")
    model_credentials = load_credentials()

    system_prompt = env("DIFY_AGENT_SYSTEM_PROMPT", "You are a concise assistant.")
    user_prompt = env("DIFY_AGENT_PROMPT", "Say hello from the Dify Agent client.")

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    config=PromptLayerConfig(prefix=system_prompt, user=user_prompt),
                ),
                RunLayerSpec(
                    name="plugin",
                    type=DIFY_PLUGIN_LAYER_TYPE_ID,
                    config=DifyPluginLayerConfig(
                        tenant_id=tenant_id,
                        plugin_id=plugin_id,
                        user_id=user_id,
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                    deps={"plugin": "plugin"},
                    config=DifyPluginLLMLayerConfig(
                        model_provider=model_provider,
                        model=model_name,
                        credentials=model_credentials,
                    ),
                ),
            ],
        ),
    )

    async with Client(base_url=api_base_url, stream_timeout=None) as client:
        run = await client.create_run(request)
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
PY

chmod +x ./run_dify_agent_client.py
```

## Configure the client request and run it

The server-side `.env` controls how Dify Agent reaches the plugin daemon. The
client request controls which tenant/plugin/provider/model and provider
credentials the run uses. Configure those values before executing the script:

```bash
export DIFY_AGENT_SERVER_URL=http://127.0.0.1:8000

export DIFY_AGENT_TENANT_ID=replace-with-tenant-id
export DIFY_AGENT_PLUGIN_ID=langgenius/openai
export DIFY_AGENT_PROVIDER=openai
export DIFY_AGENT_MODEL_NAME=gpt-4o-mini

export DIFY_AGENT_MODEL_CREDENTIALS_JSON='{"api_key":"replace-with-provider-key"}'

export DIFY_AGENT_PROMPT='用一句话介绍 Dify Agent。'

./run_dify_agent_client.py
```

The shape of `DIFY_AGENT_MODEL_CREDENTIALS_JSON` depends on the selected plugin
provider's credential schema. The `{"api_key":"..."}` value above is only an
OpenAI-style example.

## Troubleshooting

If the run fails, check these items first:

1. Redis is running and reachable from the Dify Agent server.
2. The Dify Agent server is listening on `127.0.0.1:8000`.
3. `DIFY_AGENT_PLUGIN_DAEMON_URL` points to the correct plugin daemon.
4. `DIFY_AGENT_PLUGIN_DAEMON_API_KEY` matches the plugin daemon server key.
5. `DIFY_AGENT_PLUGIN_ID`, `DIFY_AGENT_PROVIDER`, and
   `DIFY_AGENT_MODEL_NAME` match a provider available through the plugin daemon.
6. `DIFY_AGENT_MODEL_CREDENTIALS_JSON` matches that provider's credential schema.
