"""Unit tests for MCP utils module."""

import json
from collections.abc import Callable, Generator
from contextlib import nullcontext

import httpx
import httpx_sse
import pytest

from core.mcp.utils import (
    STATUS_FORCELIST,
    create_mcp_error_response,
    create_ssrf_proxy_mcp_http_client,
    ssrf_proxy_sse_connect,
)


@pytest.fixture(autouse=True)
def _mcp_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        SSRF_PROXY_ALL_URL=None,
        SSRF_PROXY_HTTP_URL=None,
        SSRF_PROXY_HTTPS_URL=None,
        HTTP_REQUEST_NODE_SSL_VERIFY=True,
        SSRF_DEFAULT_TIME_OUT=30.0,
        SSRF_DEFAULT_CONNECT_TIME_OUT=10.0,
        SSRF_DEFAULT_READ_TIME_OUT=60.0,
        SSRF_DEFAULT_WRITE_TIME_OUT=30.0,
    )


@pytest.fixture
def http_client() -> Generator[httpx.Client]:
    def unexpected_request(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected HTTP request: {request.method} {request.url}")

    with httpx.Client(transport=httpx.MockTransport(unexpected_request)) as client:
        yield client


class _SSEBoundary:
    """Record SSE dependency calls without taking ownership of the real client."""

    def __init__(self, client: httpx.Client) -> None:
        """Keep the supplied client and create fresh records and a real SSE context.

        No connection is opened and the client remains owned by its fixture.
        A missing connect_error means that connect returns the context.
        """
        self.client = client
        self.context = nullcontext(
            httpx_sse.EventSource(httpx.Response(200, headers={"content-type": "text/event-stream"}))
        )
        self.factory_calls: list[tuple[dict[str, str] | None, httpx.Timeout | None]] = []
        self.connect_calls: list[tuple[httpx.Client, str, str, dict[str, object]]] = []
        self.connect_error: httpx.ConnectError | None = None

    def create_client(
        self, headers: dict[str, str] | None = None, timeout: httpx.Timeout | None = None
    ) -> httpx.Client:
        """Record optional factory inputs and return the supplied client unchanged.

        None preserves an omitted header or timeout input. No client is closed.
        """
        self.factory_calls.append((headers, timeout))
        return self.client

    def connect(
        self, client: httpx.Client, method: str, url: str, **kwargs: object
    ) -> nullcontext[httpx_sse.EventSource]:
        """Record every connection input, then return the context or raise immediately.

        A configured connect_error is raised synchronously after recording.
        The context is never entered and the client is never closed here.
        """
        self.connect_calls.append((client, method, url, kwargs))
        if self.connect_error is not None:
            raise self.connect_error
        return self.context


@pytest.fixture
def sse_boundary(monkeypatch: pytest.MonkeyPatch, http_client: httpx.Client) -> _SSEBoundary:
    """Replace both SSE dependencies with fresh records for the supplied real client.

    Monkeypatch restores both functions after the test. Client cleanup remains
    with the production owner on error and the http_client fixture on teardown.
    """
    boundary = _SSEBoundary(http_client)
    monkeypatch.setattr("core.mcp.utils.create_ssrf_proxy_mcp_http_client", boundary.create_client)
    monkeypatch.setattr("core.mcp.utils.connect_sse", boundary.connect)
    return boundary


class TestConstants:
    """Test module constants."""

    def test_status_forcelist(self) -> None:
        """Test STATUS_FORCELIST contains expected HTTP status codes."""
        assert STATUS_FORCELIST == [429, 500, 502, 503, 504]
        assert 429 in STATUS_FORCELIST  # Too Many Requests
        assert 500 in STATUS_FORCELIST  # Internal Server Error
        assert 502 in STATUS_FORCELIST  # Bad Gateway
        assert 503 in STATUS_FORCELIST  # Service Unavailable
        assert 504 in STATUS_FORCELIST  # Gateway Timeout


class TestCreateSSRFProxyMCPHTTPClient:
    """Test create_ssrf_proxy_mcp_http_client function."""

    def test_create_client_with_all_url_proxy(self, config_overrides: Callable[..., None]) -> None:
        """Test client creation with SSRF_PROXY_ALL_URL configured."""
        config_overrides(SSRF_PROXY_ALL_URL="http://proxy.example.com:8080")

        client = create_ssrf_proxy_mcp_http_client(
            headers={"Authorization": "Bearer token"}, timeout=httpx.Timeout(30.0)
        )

        assert isinstance(client, httpx.Client)
        assert client.headers["Authorization"] == "Bearer token"
        assert client.timeout.connect == 30.0
        assert client.follow_redirects is True

        # Clean up
        client.close()

    def test_create_client_with_http_https_proxies(self, config_overrides: Callable[..., None]) -> None:
        """Test client creation with separate HTTP/HTTPS proxies."""
        config_overrides(
            SSRF_PROXY_HTTP_URL="http://http-proxy.example.com:8080",
            SSRF_PROXY_HTTPS_URL="http://https-proxy.example.com:8443",
            HTTP_REQUEST_NODE_SSL_VERIFY=False,
        )

        client = create_ssrf_proxy_mcp_http_client()

        assert isinstance(client, httpx.Client)
        assert client.follow_redirects is True

        # Clean up
        client.close()

    def test_create_client_without_proxy(self) -> None:
        """Test client creation without proxy configuration."""

        headers = {"X-Custom-Header": "value"}
        timeout = httpx.Timeout(timeout=30.0, connect=5.0, read=10.0, write=30.0)

        client = create_ssrf_proxy_mcp_http_client(headers=headers, timeout=timeout)

        assert isinstance(client, httpx.Client)
        assert client.headers["X-Custom-Header"] == "value"
        assert client.timeout.connect == 5.0
        assert client.timeout.read == 10.0
        assert client.follow_redirects is True

        # Clean up
        client.close()

    def test_create_client_default_params(self) -> None:
        """Test client creation with default parameters."""

        client = create_ssrf_proxy_mcp_http_client()

        assert isinstance(client, httpx.Client)
        # httpx.Client adds default headers, so we just check it's a Headers object
        assert isinstance(client.headers, httpx.Headers)
        # When no timeout is provided, httpx uses its default timeout
        assert client.timeout is not None

        # Clean up
        client.close()


class TestSSRFProxySSEConnect:
    """Test ssrf_proxy_sse_connect function."""

    def test_sse_connect_with_provided_client(self, sse_boundary: _SSEBoundary, http_client: httpx.Client) -> None:
        """Test SSE connection with pre-configured client."""
        result = ssrf_proxy_sse_connect(
            "http://example.com/sse", client=http_client, method="POST", headers={"Authorization": "Bearer token"}
        )

        assert sse_boundary.factory_calls == []
        assert len(sse_boundary.connect_calls) == 1
        client, method, url, kwargs = sse_boundary.connect_calls[0]
        assert client is http_client
        assert (method, url, kwargs) == (
            "POST",
            "http://example.com/sse",
            {"headers": {"Authorization": "Bearer token"}},
        )
        assert result is sse_boundary.context

    def test_sse_connect_without_client(self, sse_boundary: _SSEBoundary, http_client: httpx.Client) -> None:
        """Test SSE connection without pre-configured client."""
        result = ssrf_proxy_sse_connect("http://example.com/sse", headers={"X-Custom": "value"})

        assert len(sse_boundary.factory_calls) == 1
        headers, timeout = sse_boundary.factory_calls[0]
        assert headers == {"X-Custom": "value"}
        assert isinstance(timeout, httpx.Timeout)
        assert timeout.connect == 10.0
        assert timeout.read == 60.0
        assert timeout.write == 30.0
        assert len(sse_boundary.connect_calls) == 1
        client, method, url, kwargs = sse_boundary.connect_calls[0]
        assert client is http_client
        assert (method, url, kwargs) == ("GET", "http://example.com/sse", {})
        assert result is sse_boundary.context

    def test_sse_connect_with_custom_timeout(self, sse_boundary: _SSEBoundary, http_client: httpx.Client) -> None:
        """Test SSE connection with custom timeout."""
        custom_timeout = httpx.Timeout(timeout=60.0, read=120.0)
        result = ssrf_proxy_sse_connect("http://example.com/sse", timeout=custom_timeout)

        assert len(sse_boundary.factory_calls) == 1
        headers, timeout = sse_boundary.factory_calls[0]
        assert headers == {}
        assert timeout is custom_timeout
        assert len(sse_boundary.connect_calls) == 1
        client, method, url, kwargs = sse_boundary.connect_calls[0]
        assert client is http_client
        assert (method, url, kwargs) == ("GET", "http://example.com/sse", {})
        assert result is sse_boundary.context

    def test_sse_connect_error_cleanup(self, sse_boundary: _SSEBoundary, http_client: httpx.Client) -> None:
        """Test SSE connection cleans up client on error."""
        sse_boundary.connect_error = httpx.ConnectError("Connection failed")
        with pytest.raises(httpx.ConnectError):
            ssrf_proxy_sse_connect("http://example.com/sse")

        assert len(sse_boundary.factory_calls) == 1
        headers, timeout = sse_boundary.factory_calls[0]
        assert headers == {}
        assert isinstance(timeout, httpx.Timeout)
        assert timeout.connect == 10.0
        assert timeout.read == 60.0
        assert timeout.write == 30.0
        assert len(sse_boundary.connect_calls) == 1
        client, method, url, kwargs = sse_boundary.connect_calls[0]
        assert client is http_client
        assert (method, url, kwargs) == ("GET", "http://example.com/sse", {})
        assert http_client.is_closed

    def test_sse_connect_error_no_cleanup_with_provided_client(
        self, sse_boundary: _SSEBoundary, http_client: httpx.Client
    ) -> None:
        """Test SSE connection doesn't clean up provided client on error."""
        sse_boundary.connect_error = httpx.ConnectError("Connection failed")
        with pytest.raises(httpx.ConnectError):
            ssrf_proxy_sse_connect("http://example.com/sse", client=http_client)

        assert sse_boundary.factory_calls == []
        assert len(sse_boundary.connect_calls) == 1
        client, method, url, kwargs = sse_boundary.connect_calls[0]
        assert client is http_client
        assert (method, url, kwargs) == ("GET", "http://example.com/sse", {})
        assert not http_client.is_closed


class TestCreateMCPErrorResponse:
    """Test create_mcp_error_response function."""

    def test_create_error_response_basic(self) -> None:
        """Test creating basic error response."""
        generator = create_mcp_error_response(request_id="req-123", code=-32600, message="Invalid Request")

        # Generator should yield bytes
        assert isinstance(generator, Generator)

        # Get the response
        response_bytes = next(generator)
        assert isinstance(response_bytes, bytes)

        # Parse the response
        response_str = response_bytes.decode("utf-8")
        response_json = json.loads(response_str)

        assert response_json["jsonrpc"] == "2.0"
        assert response_json["id"] == "req-123"
        assert response_json["error"]["code"] == -32600
        assert response_json["error"]["message"] == "Invalid Request"
        assert response_json["error"]["data"] is None

        # Generator should be exhausted
        with pytest.raises(StopIteration):
            next(generator)

    def test_create_error_response_with_data(self) -> None:
        """Test creating error response with additional data."""
        error_data = {"field": "username", "reason": "required"}

        generator = create_mcp_error_response(
            request_id=456,  # Numeric ID
            code=-32602,
            message="Invalid params",
            data=error_data,
        )

        response_bytes = next(generator)
        response_json = json.loads(response_bytes.decode("utf-8"))

        assert response_json["id"] == 456
        assert response_json["error"]["code"] == -32602
        assert response_json["error"]["message"] == "Invalid params"
        assert response_json["error"]["data"] == error_data

    def test_create_error_response_without_request_id(self) -> None:
        """Test creating error response without request ID."""
        generator = create_mcp_error_response(request_id=None, code=-32700, message="Parse error")

        response_bytes = next(generator)
        response_json = json.loads(response_bytes.decode("utf-8"))

        # Should default to ID 1
        assert response_json["id"] == 1
        assert response_json["error"]["code"] == -32700
        assert response_json["error"]["message"] == "Parse error"

    def test_create_error_response_with_zero_id(self) -> None:
        """Test creating error response with zero numeric request ID.

        JSON-RPC 2.0 permits numeric id 0 (only null is reserved for
        notifications); the response must echo the same id so the client
        can match it. `request_id or 1` would rewrite 0 to 1.
        """
        generator = create_mcp_error_response(request_id=0, code=-32600, message="Invalid Request")

        response_bytes = next(generator)
        response_json = json.loads(response_bytes.decode("utf-8"))

        assert response_json["id"] == 0
        assert response_json["error"]["code"] == -32600

    def test_create_error_response_with_complex_data(self) -> None:
        """Test creating error response with complex error data."""
        complex_data = {
            "errors": [{"field": "name", "message": "Too short"}, {"field": "email", "message": "Invalid format"}],
            "timestamp": "2024-01-01T00:00:00Z",
        }

        generator = create_mcp_error_response(
            request_id="complex-req", code=-32602, message="Validation failed", data=complex_data
        )

        response_bytes = next(generator)
        response_json = json.loads(response_bytes.decode("utf-8"))

        assert response_json["error"]["data"] == complex_data
        assert len(response_json["error"]["data"]["errors"]) == 2

    def test_create_error_response_encoding(self) -> None:
        """Test error response with non-ASCII characters."""
        generator = create_mcp_error_response(
            request_id="unicode-req",
            code=-32603,
            message="内部错误",  # Chinese characters
            data={"details": "エラー詳細"},  # Japanese characters
        )

        response_bytes = next(generator)

        # Should be valid UTF-8
        response_str = response_bytes.decode("utf-8")
        response_json = json.loads(response_str)

        assert response_json["error"]["message"] == "内部错误"
        assert response_json["error"]["data"]["details"] == "エラー詳細"

    def test_create_error_response_yields_once(self) -> None:
        """Test that error response generator yields exactly once."""
        generator = create_mcp_error_response(request_id="test", code=-32600, message="Test")

        # First yield should work
        first_yield = next(generator)
        assert isinstance(first_yield, bytes)

        # Second yield should raise StopIteration
        with pytest.raises(StopIteration):
            next(generator)

        # Subsequent calls should also raise
        with pytest.raises(StopIteration):
            next(generator)
