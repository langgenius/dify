"""Example consumer for the Dify Agent run server.

Requires Redis and a running API server. The server starts its Redis Streams
worker in the same process by default, for example:

    uv run --project dify-agent uvicorn dify_agent.server.app:app --reload

The default request uses the credential-free pydantic-ai TestModel profile. This
script prints the created run and every event observed through cursor polling.
"""

import asyncio

import httpx


API_BASE_URL = "http://localhost:8000"


async def main() -> None:
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=30) as client:
        create_response = await client.post(
            "/runs",
            json={
                "compositor": {
                    "schema_version": 1,
                    "layers": [
                        {
                            "name": "prompt",
                            "type": "plain.prompt",
                            "config": {
                                "prefix": "You are a concise assistant.",
                                "user": "Say hello from the Dify Agent API server example.",
                            },
                        }
                    ],
                },
                "agent_profile": {"provider": "test", "output_text": "Hello from the example TestModel."},
            },
        )
        create_response.raise_for_status()
        run = create_response.json()
        print("created run", run)

        cursor = "0-0"
        while True:
            events_response = await client.get(f"/runs/{run['run_id']}/events", params={"after": cursor})
            events_response.raise_for_status()
            page = events_response.json()
            cursor = page["next_cursor"] or cursor
            for event in page["events"]:
                print("event", event)
                if event["type"] in {"run_succeeded", "run_failed"}:
                    return
            await asyncio.sleep(0.5)


if __name__ == "__main__":
    asyncio.run(main())
