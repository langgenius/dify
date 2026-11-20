"""Exercise the actual relay's authentication, path restriction and CDP forwarding."""

import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from cdp_gateway import create_app


class GatewayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async def version(request):
            return web.json_response(
                {"webSocketDebuggerUrl": "ws://localhost/devtools/browser/test"}
            )

        async def echo(request):
            socket = web.WebSocketResponse()
            await socket.prepare(request)
            async for message in socket:
                await socket.send_str(message.data)
            return socket

        backend = web.Application()
        backend.router.add_get("/json/version", version)
        backend.router.add_get("/devtools/browser/test", echo)
        self.backend = TestServer(backend)
        await self.backend.start_server()
        self.client = TestClient(
            TestServer(
                create_app(str(self.backend.make_url("")).rstrip("/"), "test-token")
            )
        )
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.backend.close()

    async def test_rejects_missing_token_and_browser_origin(self):
        r = await self.client.get("/json/version")
        self.assertEqual(r.status, 401)
        r = await self.client.get(
            "/json/version",
            headers={
                "Authorization": "Bearer test-token",
                "Origin": "http://untrusted",
            },
        )
        self.assertEqual(r.status, 401)

    async def test_limits_routes_and_relays_cdp(self):
        headers = {"Authorization": "Bearer test-token"}
        r = await self.client.get("/json/new", headers=headers)
        self.assertEqual(r.status, 404)
        r = await self.client.get("/json/version", headers=headers)
        data = await r.json()
        self.assertIn(str(self.client.server.host), data["webSocketDebuggerUrl"])
        ws = await self.client.ws_connect("/devtools/browser/test", headers=headers)
        await ws.send_str('{"id":1,"method":"Browser.getVersion"}')
        reply = await ws.receive()
        self.assertIn("Browser.getVersion", reply.data)
        await ws.close()


if __name__ == "__main__":
    unittest.main()
