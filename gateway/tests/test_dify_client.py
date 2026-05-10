"""Tests for the Dify async HTTP client.

We use ``respx`` to intercept httpx calls without spinning up a real Dify.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from gateway.dify.client import ConsoleSession, DifyClient
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


def _login_response_with_cookies(
    access_token: str = "access-abc",
    csrf_token: str = "csrf-xyz",
    *,
    host_prefixed: bool = False,
) -> httpx.Response:
    """Build a login response that mimics Dify's Set-Cookie behavior."""
    access_name = "__Host-access_token" if host_prefixed else "access_token"
    csrf_name = "__Host-csrf_token" if host_prefixed else "csrf_token"
    headers = [
        ("set-cookie", f"{access_name}={access_token}; Path=/; HttpOnly"),
        ("set-cookie", f"{csrf_name}={csrf_token}; Path=/"),
    ]
    return httpx.Response(200, headers=headers, json={"result": "success"})


@pytest.mark.asyncio
async def test_console_login_returns_session_from_cookies(client: DifyClient) -> None:
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/login").mock(return_value=_login_response_with_cookies())
        session = await client.console_login("admin@x", "pw")

    assert isinstance(session, ConsoleSession)
    assert session.access_token == "access-abc"
    assert session.csrf_token == "csrf-xyz"


@pytest.mark.asyncio
async def test_console_login_supports_host_prefixed_cookies(client: DifyClient) -> None:
    """Dify uses __Host- prefix on cookies for HTTPS deploys without cookie domain."""
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/login").mock(
            return_value=_login_response_with_cookies(
                access_token="hosted-a", csrf_token="hosted-c", host_prefixed=True
            )
        )
        session = await client.console_login("admin@x", "pw")

    assert session.access_token == "hosted-a"
    assert session.csrf_token == "hosted-c"
    # Cookie names must round-trip so Dify's _real_cookie_name extractors find them.
    assert session.access_token_cookie_name == "__Host-access_token"
    assert session.csrf_token_cookie_name == "__Host-csrf_token"


@pytest.mark.asyncio
async def test_console_calls_echo_host_prefixed_cookie_names(client: DifyClient) -> None:
    """Regression: subsequent console calls must use the same cookie names as login.

    Without this, HTTPS Dify deployments (which set ``__Host-csrf_token``)
    would see ``X-CSRF-Token`` header valued correctly but the
    ``csrf_token`` cookie name unrecognised, failing CSRF check (401).
    """
    session = ConsoleSession(
        access_token="acc-secure",
        csrf_token="csrf-secure",
        access_token_cookie_name="__Host-access_token",
        csrf_token_cookie_name="__Host-csrf_token",
    )
    with respx.mock(base_url="http://dify.test") as m:
        route = m.post("/console/api/apps/imports").mock(
            return_value=httpx.Response(200, json={"app_id": "a-1"})
        )
        await client.console_import_app(session, "yaml: ...")

    cookie_hdr = route.calls.last.request.headers.get("cookie", "")
    # Both cookies must use the host-prefixed name on the wire.
    assert "__Host-access_token=acc-secure" in cookie_hdr
    assert "__Host-csrf_token=csrf-secure" in cookie_hdr
    # Header name itself is fixed; only cookie names vary.
    assert route.calls.last.request.headers["x-csrf-token"] == "csrf-secure"


@pytest.mark.asyncio
async def test_console_login_missing_cookies_raises(client: DifyClient) -> None:
    """If Dify's response lacks the expected cookies, surface a clear error."""
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/login").mock(
            return_value=httpx.Response(200, json={"result": "success"})  # no Set-Cookie
        )
        with pytest.raises(DifyUpstreamError, match="did not set expected cookies"):
            await client.console_login("admin@x", "pw")


@pytest.mark.asyncio
async def test_console_import_app_sends_csrf_header_and_cookies(client: DifyClient) -> None:
    session = ConsoleSession(access_token="a-tok", csrf_token="c-tok")
    with respx.mock(base_url="http://dify.test") as m:
        route = m.post("/console/api/apps/imports").mock(
            return_value=httpx.Response(200, json={"app_id": "app-uuid-1"})
        )
        app_id = await client.console_import_app(session, "yaml: ...")

    assert app_id == "app-uuid-1"
    sent = route.calls.last.request
    assert sent.headers["x-csrf-token"] == "c-tok"
    assert sent.headers["authorization"] == "Bearer a-tok"
    # httpx normalizes the Cookie header; both names should appear in it.
    cookie_hdr = sent.headers.get("cookie", "")
    assert "access_token=a-tok" in cookie_hdr
    assert "csrf_token=c-tok" in cookie_hdr


@pytest.mark.asyncio
async def test_console_import_app_accepts_id_field(client: DifyClient) -> None:
    """Some Dify versions return ``id`` instead of ``app_id``."""
    session = ConsoleSession(access_token="a", csrf_token="c")
    with respx.mock(base_url="http://dify.test") as m:
        m.post("/console/api/apps/imports").mock(
            return_value=httpx.Response(200, json={"id": "app-uuid-2"})
        )
        app_id = await client.console_import_app(session, "yaml: ...")
    assert app_id == "app-uuid-2"


@pytest.mark.asyncio
async def test_console_create_app_api_key(client: DifyClient) -> None:
    session = ConsoleSession(access_token="a", csrf_token="c")
    with respx.mock(base_url="http://dify.test") as m:
        route = m.post("/console/api/apps/app-uuid-1/api-keys").mock(
            return_value=httpx.Response(200, json={"token": "app-token-abc"})
        )
        token = await client.console_create_app_api_key(session, "app-uuid-1")
    assert token == "app-token-abc"
    assert route.calls.last.request.headers["x-csrf-token"] == "c"


@pytest.mark.asyncio
async def test_console_delete_app_treats_404_as_idempotent(client: DifyClient) -> None:
    session = ConsoleSession(access_token="a", csrf_token="c")
    with respx.mock(base_url="http://dify.test") as m:
        m.delete("/console/api/apps/app-uuid-gone").mock(return_value=httpx.Response(404))
        await client.console_delete_app(session, "app-uuid-gone")


@pytest.mark.asyncio
async def test_console_delete_app_raises_on_other_failures(client: DifyClient) -> None:
    session = ConsoleSession(access_token="a", csrf_token="c")
    with respx.mock(base_url="http://dify.test") as m:
        m.delete("/console/api/apps/app-uuid-1").mock(return_value=httpx.Response(500))
        with pytest.raises(DifyUpstreamError):
            await client.console_delete_app(session, "app-uuid-1")


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
