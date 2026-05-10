"""Tests for the Dify async HTTP client.

We use ``respx`` to intercept httpx calls without spinning up a real Dify.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from gateway.dify.client import DifyClient
from gateway.errors import DifyTimeoutError, DifyUpstreamError


@pytest.fixture
async def client() -> DifyClient:
    c = DifyClient(base_url="http://dify.test", timeout_s=5.0, stream_timeout_s=5.0)
    try:
        yield c
    finally:
        await c.aclose()


@pytest.mark.asyncio
async def test_chat_messages_blocking_returns_parsed_body(client: DifyClient) -> None:
    expected = {"id": "msg-1", "answer": "hi", "conversation_id": "conv-1", "metadata": {}}
    with respx.mock(base_url="http://dify.test") as m:
        route = m.post("/v1/chat-messages").mock(return_value=httpx.Response(200, json=expected))
        result = await client.chat_messages_blocking(
            app_key="app-x", query="hello", user="u1"
        )
    assert result == expected
    assert route.called
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer app-x"


@pytest.mark.asyncio
async def test_chat_messages_blocking_includes_conversation_id_when_provided(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        route = m.post("/v1/chat-messages").mock(return_value=httpx.Response(200, json={}))
        await client.chat_messages_blocking(
            app_key="app-x", query="q", user="u", conversation_id="conv-9"
        )
    body = route.calls.last.request.read().decode()
    assert "conv-9" in body


@pytest.mark.asyncio
async def test_chat_messages_blocking_omits_conversation_id_when_absent(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        route = m.post("/v1/chat-messages").mock(return_value=httpx.Response(200, json={}))
        await client.chat_messages_blocking(app_key="app-x", query="q", user="u")
    body = route.calls.last.request.read().decode()
    assert "conversation_id" not in body


@pytest.mark.asyncio
async def test_chat_messages_blocking_raises_on_5xx(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/v1/chat-messages").mock(return_value=httpx.Response(500, text="boom"))
        with pytest.raises(DifyUpstreamError, match="500"):
            await client.chat_messages_blocking(app_key="app-x", query="q", user="u")


@pytest.mark.asyncio
async def test_chat_messages_blocking_raises_on_timeout(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/v1/chat-messages").mock(side_effect=httpx.TimeoutException("read timeout"))
        with pytest.raises(DifyTimeoutError):
            await client.chat_messages_blocking(app_key="app-x", query="q", user="u")


@pytest.mark.asyncio
async def test_console_login_returns_token(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/login").mock(
            return_value=httpx.Response(200, json={"data": {"access_token": "jwt-abc"}})
        )
        token = await client.console_login("admin@x", "pw")
    assert token == "jwt-abc"


@pytest.mark.asyncio
async def test_console_login_invalid_payload_raises(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/login").mock(return_value=httpx.Response(200, json={"data": {}}))
        with pytest.raises(DifyUpstreamError, match="unexpected payload"):
            await client.console_login("admin@x", "pw")


@pytest.mark.asyncio
async def test_console_import_app_accepts_app_id_field(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/apps/imports").mock(
            return_value=httpx.Response(200, json={"app_id": "app-uuid-1"})
        )
        app_id = await client.console_import_app("jwt", "yaml: ...")
    assert app_id == "app-uuid-1"


@pytest.mark.asyncio
async def test_console_import_app_accepts_id_field(client: DifyClient) -> None:
    """Some Dify versions return ``id`` instead of ``app_id``."""
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/apps/imports").mock(
            return_value=httpx.Response(200, json={"id": "app-uuid-2"})
        )
        app_id = await client.console_import_app("jwt", "yaml: ...")
    assert app_id == "app-uuid-2"


@pytest.mark.asyncio
async def test_console_create_app_api_key(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/apps/app-uuid-1/api-keys").mock(
            return_value=httpx.Response(200, json={"token": "app-token-abc"})
        )
        token = await client.console_create_app_api_key("jwt", "app-uuid-1")
    assert token == "app-token-abc"


@pytest.mark.asyncio
async def test_console_delete_app_treats_404_as_idempotent(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.delete("/console/api/apps/app-uuid-gone").mock(return_value=httpx.Response(404))
        # Should not raise.
        await client.console_delete_app("jwt", "app-uuid-gone")


@pytest.mark.asyncio
async def test_console_delete_app_raises_on_other_failures(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.delete("/console/api/apps/app-uuid-1").mock(return_value=httpx.Response(500))
        with pytest.raises(DifyUpstreamError):
            await client.console_delete_app("jwt", "app-uuid-1")


@pytest.mark.asyncio
async def test_chat_messages_streaming_yields_lines(client: DifyClient) -> None:
    body = b'data: {"event":"message","answer":"a"}\n\ndata: {"event":"message_end"}\n\n'
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/v1/chat-messages").mock(
            return_value=httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)
        )
        lines = [line async for line in client.chat_messages_streaming(
            app_key="app-x", query="q", user="u"
        )]
    # At minimum, the two data lines should be present in the iterator.
    joined = "\n".join(lines)
    assert "message" in joined
    assert "message_end" in joined
