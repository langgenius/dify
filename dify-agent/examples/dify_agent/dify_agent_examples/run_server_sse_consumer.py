"""SSE consumer sketch for the Dify Agent run server.

Create a run with ``run_server_consumer.py`` or any HTTP client, then set RUN_ID
below and run this script while the server is available. It prints raw SSE frames
without requiring model credentials.
"""

import asyncio

import httpx


API_BASE_URL = "http://localhost:8000"
RUN_ID = "replace-with-run-id"


async def main() -> None:
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=None) as client:
        async with client.stream("GET", f"/runs/{RUN_ID}/events/sse") as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                print(line)


if __name__ == "__main__":
    asyncio.run(main())
