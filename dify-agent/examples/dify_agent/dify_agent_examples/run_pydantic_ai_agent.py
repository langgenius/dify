"""Run a Pydantic AI agent through the Dify API LLM gateway.

Prerequisites:
- Sync the server runtime dependencies first: `uv sync --project dify-agent --extra server`.
- Run the Dify API with its inner Agent LLM endpoint enabled.
- Fill `dify-agent/.env` with a real tenant, user, app, plugin, provider, and model.

This example is meant to be run from a source checkout because
`dify_agent_examples` is not part of the published package.

Example from the repository root:
    PYTHONPATH=dify-agent/src:dify-agent/examples/dify_agent \
    uv run --project dify-agent python -m dify_agent_examples.run_pydantic_ai_agent
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import httpx
from pydantic_ai import Agent

from dify_agent.adapters.llm import DifyApiLLMProvider, DifyLLMAdapterModel
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


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


async def main() -> None:
    load_env_file(PROJECT_ROOT / ".env")

    async with httpx.AsyncClient(timeout=600, trust_env=False) as http_client:
        provider = DifyApiLLMProvider(
            plugin_id=required_env("DIFY_AGENT_PLUGIN_ID"),
            inner_api_url=required_env("DIFY_INNER_API_URL"),
            inner_api_key=required_env("DIFY_INNER_API_KEY"),
            execution_context=DifyExecutionContextLayerConfig(
                tenant_id=required_env("DIFY_AGENT_TENANT_ID"),
                user_id=required_env("DIFY_AGENT_USER_ID"),
                user_from="account",
                app_id=required_env("DIFY_AGENT_APP_ID"),
                agent_mode="single_step",
                invoke_from="debugger",
            ),
            agent_run_id=str(uuid4()),
            http_client=http_client,
        )
        model = DifyLLMAdapterModel(
            required_env("DIFY_AGENT_MODEL_NAME"),
            provider,
            model_provider=required_env("DIFY_AGENT_PROVIDER"),
        )
        agent = Agent(model=model)
        async with agent.run_stream("Explain the theory of relativity") as run:
            async for piece in run.stream_output():
                print(piece, end="", flush=True)
            print(run.usage)


if __name__ == "__main__":
    asyncio.run(main())
