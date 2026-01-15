"""Unit tests for MCP utils module."""

import json
from collections.abc import Generator
from unittest.mock import MagicMock, Mock, patch

import httpx
import httpx_sse
import pytest

from core.mcp.utils import (
    STATUS_FORCELIST,
    create_mcp_error_response,
    create_ssrf_proxy_mcp_http_client,
    ssrf_proxy_sse_connect,
)


class TestConstants:
    """Test module constants."""

    def test_status_forcelist(self):
        """Test STATUS_FORCELIST contains expected HTTP status codes."""
        assert STATUS_FORCELIST == [429, 500, 502, 503, 504]
        assert 429 in STATUS_FORCELIST  # Too Many Requests
        assert 500 in STATUS_FORCELIST  # Internal Server Error
        assert 502 in STATUS_FORCELIST  # Bad Gateway
        assert 503 in STATUS_FORCELIST  # Service Unavailable
        assert 504 in STATUS_FORCELIST  # Gateway Timeout


class TestCreateSSRFProxyMCPHTTPClient:
    """Test create_ssrf_proxy_mcp_http_client function."""

    @patch("core.mcp.utils.dify_config")
    def test_create_client_with_all_url_proxy(self, mock_config):
        """Test client creation with SSRF_PROXY_ALL_URL configured."""
        mock_config.SSRF_PROXY_ALL_URL = "http://proxy.example.com:8080"
        mock_config.HTTP_REQUEST_NODE_SSL_VERIFY = True

        client = create_ssrf_proxy_mcp_http_client(
            headers={"Authorization": "Bearer token"}, timeout=httpx.Timeout(30.0)
        )

        assert isinstance(client, httpx.Client)
        assert client.headers["Authorization"] == "Bearer token"
        assert client.timeout.connect == 30.0
        assert client.follow_redirects is True

        # Clean up
        client.close()

    @patch("core.mcp.utils.dify_config")
    def test_create_client_with_http_https_proxies(self, mock_config):
        """Test client creation with separate HTTP/HTTPS proxies."""
        mock_config.SSRF_PROXY_ALL_URL = None
        mock_config.SSRF_PROXY_HTTP_URL = "http://http-proxy.example.com:8080"
        mock_config.SSRF_PROXY_HTTPS_URL = "http://https-proxy.example.com:8443"
        mock_config.HTTP_REQUEST_NODE_SSL_VERIFY = False

        client = create_ssrf_proxy_mcp_http_client()

        assert isinstance(client, httpx.Client)
        assert client.follow_redirects is True

        # Clean up
        client.close()

    @patch("core.mcp.utils.dify_config")
    def test_create_client_without_proxy(self, mock_config):
        """Test client creation without proxy configuration."""
        mock_config.SSRF_PROXY_ALL_URL = None
        mock_config.SSRF_PROXY_HTTP_URL = None
        mock_config.SSRF_PROXY_HTTPS_URL = None
        mock_config.HTTP_REQUEST_NODE_SSL_VERIFY = True

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

    @patch("core.mcp.utils.dify_config")
    def test_create_client_default_params(self, mock_config):
        """Test client creation with default parameters."""
        mock_config.SSRF_PROXY_ALL_URL = None
        mock_config.SSRF_PROXY_HTTP_URL = None
        mock_config.SSRF_PROXY_HTTPS_URL = None
        mock_config.HTTP_REQUEST_NODE_SSL_VERIFY = True

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

    @patch("core.mcp.utils.connect_sse")
    @patch("core.mcp.utils.create_ssrf_proxy_mcp_http_client")
    def test_sse_connect_with_provided_client(self, mock_create_client, mock_connect_sse):
        """Test SSE connection with pre-configured client."""
        # Setup mocks
        mock_client = Mock(spec=httpx.Client)
        mock_event_source = Mock(spec=httpx_sse.EventSource)
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_event_source
        mock_connect_sse.return_value = mock_context

        # Call with provided client
        result = ssrf_proxy_sse_connect(
            "http://example.com/sse", client=mock_client, method="POST", headers={"Authorization": "Bearer token"}
        )

        # Verify client creation was not called
        mock_create_client.assert_not_called()

        # Verify connect_sse was called correctly
        mock_connect_sse.assert_called_once_with(
            mock_client, "POST", "http://example.com/sse", headers={"Authorization": "Bearer token"}
        )

        # Verify result
        assert result == mock_context

    @patch("core.mcp.utils.connect_sse")
    @patch("core.mcp.utils.create_ssrf_proxy_mcp_http_client")
    @patch("core.mcp.utils.dify_config")
    def test_sse_connect_without_client(self, mock_config, mock_create_client, mock_connect_sse):
        """Test SSE connection without pre-configured client."""
        # Setup config
        mock_config.SSRF_DEFAULT_TIME_OUT = 30.0
        mock_config.SSRF_DEFAULT_CONNECT_TIME_OUT = 10.0
        mock_config.SSRF_DEFAULT_READ_TIME_OUT = 60.0
        mock_config.SSRF_DEFAULT_WRITE_TIME_OUT = 30.0

        # Setup mocks
        mock_client = Mock(spec=httpx.Client)
        mock_create_client.return_value = mock_client

        mock_event_source = Mock(spec=httpx_sse.EventSource)
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_event_source
        mock_connect_sse.return_value = mock_context

        # Call without client
        result = ssrf_proxy_sse_connect("http://example.com/sse", headers={"X-Custom": "value"})

        # Verify client was created
        mock_create_client.assert_called_once()
        call_args = mock_create_client.call_args
        assert call_args[1]["headers"] == {"X-Custom": "value"}

        timeout = call_args[1]["timeout"]
        # httpx.Timeout object has these attributes
        assert isinstance(timeout, httpx.Timeout)
        assert timeout.connect == 10.0
        assert timeout.read == 60.0
        assert timeout.write == 30.0

        # Verify connect_sse was called
        mock_connect_sse.assert_called_once_with(
            mock_client,
            "GET",  # Default method
            "http://example.com/sse",
        )

        # Verify result
        assert result == mock_context

    @patch("core.mcp.utils.connect_sse")
    @patch("core.mcp.utils.create_ssrf_proxy_mcp_http_client")
    def test_sse_connect_with_custom_timeout(self, mock_create_client, mock_connect_sse):
        """Test SSE connection with custom timeout."""
        # Setup mocks
        mock_client = Mock(spec=httpx.Client)
        mock_create_client.return_value = mock_client

        mock_event_source = Mock(spec=httpx_sse.EventSource)
        mock_context = MagicMock()
        mock_context.__enter__.return_value = mock_event_source
        mock_connect_sse.return_value = mock_context

        custom_timeout = httpx.Timeout(timeout=60.0, read=120.0)

        # Call with custom timeout
        result = ssrf_proxy_sse_connect("http://example.com/sse", timeout=custom_timeout)

        # Verify client was created with custom timeout
        mock_create_client.assert_called_once()
        call_args = mock_create_client.call_args
        assert call_args[1]["timeout"] == custom_timeout

        # Verify result
        assert result == mock_context

    @patch("core.mcp.utils.connect_sse")
    @patch("core.mcp.utils.create_ssrf_proxy_mcp_http_client")
    def test_sse_connect_error_cleanup(self, mock_create_client, mock_connect_sse):
        """Test SSE connection cleans up client on error."""
        # Setup mocks
        mock_client = Mock(spec=httpx.Client)
        mock_create_client.return_value = mock_client

        # Make connect_sse raise an exception
        mock_connect_sse.side_effect = httpx.ConnectError("Connection failed")

        # Call should raise the exception
        with pytest.raises(httpx.ConnectError):
            ssrf_proxy_sse_connect("http://example.com/sse")

        # Verify client was cleaned up
        mock_client.close.assert_called_once()

    @patch("core.mcp.utils.connect_sse")
    def test_sse_connect_error_no_cleanup_with_provided_client(self, mock_connect_sse):
        """Test SSE connection doesn't clean up provided client on error."""
        # Setup mocks
        mock_client = Mock(spec=httpx.Client)

        # Make connect_sse raise an exception
        mock_connect_sse.side_effect = httpx.ConnectError("Connection failed")

        # Call should raise the exception
        with pytest.raises(httpx.ConnectError):
            ssrf_proxy_sse_connect("http://example.com/sse", client=mock_client)

        # Verify client was NOT cleaned up (because it was provided)
        mock_client.close.assert_not_called()


class TestCreateMCPErrorResponse:
    """Test create_mcp_error_response function."""

    def test_create_error_response_basic(self):
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

    def test_create_error_response_with_data(self):
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

    def test_create_error_response_without_request_id(self):
        """Test creating error response without request ID."""
        generator = create_mcp_error_response(request_id=None, code=-32700, message="Parse error")

        response_bytes = next(generator)
        response_json = json.loads(response_bytes.decode("utf-8"))

        # Should default to ID 1
        assert response_json["id"] == 1
        assert response_json["error"]["code"] == -32700
        assert response_json["error"]["message"] == "Parse error"

    def test_create_error_response_with_complex_data(self):
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

    def test_create_error_response_encoding(self):
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

    def test_create_error_response_yields_once(self):
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
