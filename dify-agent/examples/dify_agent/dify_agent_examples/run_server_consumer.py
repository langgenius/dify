"""Async Python client example for the Dify Agent run server.

Requires Redis and a running API server. The server schedules runs in-process, for
example:

    uv run --project dify-agent uvicorn dify_agent.server.app:app --reload

The request carries Dify plugin model configuration in Agenton layers. This
script prints the created run and every event observed through cursor polling.
``Client.create_run`` performs one POST attempt only; use polling or SSE replay to
recover after client-side uncertainty.
"""

import asyncio

from agenton.compositor import CompositorConfig, LayerNodeConfig
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.dify_plugin import (
    DifyPluginCredentialValue,
    DifyPluginLLMLayerConfig,
    DifyPluginLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest


API_BASE_URL = "http://localhost:8000"
TENANT_ID = "replace-with-tenant-id"
PLUGIN_ID = "langgenius/openai"
PLUGIN_PROVIDER = "openai"
MODEL_NAME = "gpt-4o-mini"
MODEL_CREDENTIALS: dict[str, DifyPluginCredentialValue] = {"api_key": "replace-with-provider-key"}


async def main() -> None:
    async with Client(base_url=API_BASE_URL) as client:
        run = await client.create_run(
            CreateRunRequest(
                compositor=CompositorConfig(
                    layers=[
                        LayerNodeConfig(
                            name="prompt",
                            type="plain.prompt",
                            config=PromptLayerConfig(
                                prefix="You are a concise assistant.",
                                user="Say hello from the Dify Agent API server example.",
                            ),
                        ),
                        LayerNodeConfig(
                            name="plugin",
                            type="dify.plugin",
                            config=DifyPluginLayerConfig(tenant_id=TENANT_ID, plugin_id=PLUGIN_ID),
                        ),
                        LayerNodeConfig(
                            name=DIFY_AGENT_MODEL_LAYER_ID,
                            type="dify.plugin.llm",
                            deps={"plugin": "plugin"},
                            config=DifyPluginLLMLayerConfig(
                                provider=PLUGIN_PROVIDER,
                                model=MODEL_NAME,
                                credentials=MODEL_CREDENTIALS,
                            ),
                        ),
                    ],
                ),
            )
        )
        print("created run", run)

        cursor = "0-0"
        while True:
            page = await client.get_events(run.run_id, after=cursor)
            cursor = page.next_cursor or cursor
            for event in page.events:
                print("event", event)
                if event.type in {"run_succeeded", "run_failed"}:
                    return
            await asyncio.sleep(0.5)


if __name__ == "__main__":
    asyncio.run(main())
