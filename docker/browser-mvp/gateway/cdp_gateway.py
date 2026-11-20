"""Fixed-upstream CDP relay. Host ingress requires a random bearer credential."""

import argparse
import asyncio
import hmac
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession, WSMsgType, web


def create_app(upstream_url, required=None, headers=None):
    headers = headers or {}

    async def relay(request):
        if required and (
            request.headers.get("Origin")
            or not hmac.compare_digest(
                request.headers.get("Authorization", ""), "Bearer " + required
            )
        ):
            raise web.HTTPUnauthorized()
        path = request.path
        if path != "/json/version" and not path.startswith("/devtools/browser/"):
            raise web.HTTPNotFound()
        async with ClientSession(headers=headers, trust_env=False) as client:
            if path == "/json/version":
                async with client.get(upstream_url + path) as response:
                    response.raise_for_status()
                    data = await response.json()
                remote = urlsplit(data["webSocketDebuggerUrl"])
                data["webSocketDebuggerUrl"] = "ws://" + request.host + remote.path
                return web.json_response(data)
            async with client.ws_connect(
                upstream_url + path, max_msg_size=32 * 1024 * 1024
            ) as upstream:
                downstream = web.WebSocketResponse(max_msg_size=32 * 1024 * 1024)
                await downstream.prepare(request)

                async def pump(source, target):
                    async for msg in source:
                        if msg.type == WSMsgType.TEXT:
                            await target.send_str(msg.data)
                        elif msg.type == WSMsgType.BINARY:
                            await target.send_bytes(msg.data)
                        else:
                            break

                tasks = [
                    asyncio.create_task(pump(upstream, downstream)),
                    asyncio.create_task(pump(downstream, upstream)),
                ]
                _, pending = await asyncio.wait(
                    tasks, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                return downstream

    app = web.Application()
    app.router.add_get("/{path:.*}", relay)
    return app


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--upstream", required=True)
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--require-token", type=Path)
    p.add_argument("--upstream-token", type=Path)
    a = p.parse_args()
    required = a.require_token.read_text().strip() if a.require_token else None
    headers = (
        {"Authorization": "Bearer " + a.upstream_token.read_text().strip()}
        if a.upstream_token
        else {}
    )
    web.run_app(
        create_app(a.upstream, required, headers),
        host="0.0.0.0",
        port=a.port,
        access_log=None,
    )


if __name__ == "__main__":
    main()
