"""Async SSE client example for the Dify Agent run server.

Create a run with ``run_server_consumer.py`` or any HTTP client, then set RUN_ID
below and run this script while the server is available. The Python client parses
SSE frames into typed protocol events and reconnects with the latest event id by
default. Malformed frames and HTTP 4xx responses fail without reconnecting.
"""

import asyncio

from dify_agent.client import Client


API_BASE_URL = "http://localhost:8000"
RUN_ID = "replace-with-run-id"


async def main() -> None:
    async with Client(base_url=API_BASE_URL, stream_timeout=None) as client:
        async for event in client.stream_events(RUN_ID):
            print(event)


if __name__ == "__main__":
    asyncio.run(main())
