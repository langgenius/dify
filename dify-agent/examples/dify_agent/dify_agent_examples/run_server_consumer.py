"""Async Python client example for the Dify Agent run server.

Requires Redis and a running API server. The server schedules runs in-process, for
example:

    uv run --project dify-agent uvicorn dify_agent.server.app:app --reload

The default request uses the credential-free pydantic-ai TestModel profile. This
script prints the created run and every event observed through cursor polling.
``Client.create_run`` performs one POST attempt only; use polling or SSE replay to
recover after client-side uncertainty.
"""

import asyncio

from agenton.compositor import CompositorConfig, LayerNodeConfig
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.client import Client
from dify_agent.protocol import AgentProfileConfig, CreateRunRequest


API_BASE_URL = "http://localhost:8000"


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
                        )
                    ],
                ),
                agent_profile=AgentProfileConfig(output_text="Hello from the example TestModel."),
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
