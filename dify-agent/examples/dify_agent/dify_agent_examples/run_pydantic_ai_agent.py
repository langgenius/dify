"""Run a Pydantic AI agent through the Dify plugin-daemon adapter.

Prerequisites:
- Sync the server runtime dependencies first: `uv sync --project dify-agent --extra server`.
- Start the plugin daemon from `dify-aio/dify/docker/docker-compose.middleware.yaml`.
- Run the Dify API with `dify-aio/dify/api/.env` so the daemon can resolve tenants/plugins.
- Fill `dify-agent/.env` with a real tenant, plugin, provider, model, and provider credentials.

This example is meant to be run from a source checkout because
`dify_agent_examples` is not part of the published package.

Example from the repository root:
    PYTHONPATH=dify-agent/src:dify-agent/examples/dify_agent \
    uv run --project dify-agent python -m dify_agent_examples.run_pydantic_ai_agent
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from pydantic_ai import Agent

from dify_agent.adapters.llm import DifyLLMAdapterModel, DifyPluginDaemonProvider


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def load_env_file(path: Path) -> None:
    """Load simple KEY=VALUE lines without adding a dotenv dependency."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if value:
        return value
    raise RuntimeError(f"Missing required environment variable: {name}")


def load_credentials() -> dict[str, Any]:
    raw_credentials = required_env("DIFY_AGENT_MODEL_CREDENTIALS_JSON")
    credentials = json.loads(raw_credentials)
    if not isinstance(credentials, dict):
        raise RuntimeError("DIFY_AGENT_MODEL_CREDENTIALS_JSON must be a JSON object")
    return credentials


async def main() -> None:
    load_env_file(PROJECT_ROOT / ".env")

    model = DifyLLMAdapterModel(
        required_env("DIFY_AGENT_MODEL_NAME"),
        DifyPluginDaemonProvider(
            tenant_id=required_env("DIFY_AGENT_TENANT_ID"),
            plugin_id=required_env("DIFY_AGENT_PLUGIN_ID"),
            plugin_daemon_url=required_env("PLUGIN_DAEMON_URL"),
            plugin_daemon_api_key=required_env("PLUGIN_DAEMON_KEY"),
        ),
        model_provider=required_env("DIFY_AGENT_PROVIDER"),
        credentials=load_credentials(),
    )
    agent = Agent(model=model)
    async with agent.run_stream("Explain the theory of relativity") as run:
        async for piece in run.stream_output():
            print(piece, end="", flush=True)
        print(run.usage())


if __name__ == "__main__":
    asyncio.run(main())
