import json
from collections.abc import Generator
from contextlib import AbstractContextManager
from urllib.parse import urlparse, urlunparse, quote

import httpx
import httpx_sse
from httpx_sse import connect_sse

from configs import dify_config
from core.mcp.types import ErrorData, JSONRPCError
from core.model_runtime.utils.encoders import jsonable_encoder

HTTP_REQUEST_NODE_SSL_VERIFY = dify_config.HTTP_REQUEST_NODE_SSL_VERIFY

STATUS_FORCELIST = [429, 500, 502, 503, 504]


def _build_proxy_url(host: str, username: str, password: str) -> str:
    """Normalize and assemble a proxy URL with optional basic auth.

    Args:
        host: Proxy host, may or may not include scheme and port.
        username: Optional username for basic auth.
        password: Optional password for basic auth.

    Returns:
        A properly formatted proxy URL, defaulting to http scheme if missing.
    """
    parsed = urlparse(host if "://" in host else f"http://{host}")

    hostname = parsed.hostname or ""
    netloc = f"{hostname}:{parsed.port}" if parsed.port else hostname

    if username or password:
        u = quote(username or "", safe="")
        p = quote(password or "", safe="")
        netloc = f"{u}:{p}@{netloc}"

    return urlunparse((parsed.scheme, netloc, parsed.path or "", parsed.params, parsed.query, parsed.fragment))


def _build_proxy_mounts(proxy_url: str) -> dict[str, httpx.HTTPTransport]:
    """Create HTTP/HTTPS transports that route through the given proxy URL."""
    return {
        "http://": httpx.HTTPTransport(proxy=proxy_url, verify=HTTP_REQUEST_NODE_SSL_VERIFY),
        "https://": httpx.HTTPTransport(proxy=proxy_url, verify=HTTP_REQUEST_NODE_SSL_VERIFY),
    }


def create_ssrf_proxy_mcp_http_client(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
    proxy: dict[str, str] | None = None,
) -> httpx.Client:
    """Create an HTTPX client with SSRF proxy configuration for MCP connections.

    Args:
        headers: Optional headers to include in the client
        timeout: Optional timeout configuration

    Returns:
        Configured httpx.Client with proxy settings
    """
    # Per-provider proxy overrides global SSRF proxy settings
    if proxy and isinstance(proxy, dict) and proxy.get("host"):
        proxy_url = _build_proxy_url(
            str(proxy.get("host", "")).strip(),
            str(proxy.get("username", "")).strip(),
            str(proxy.get("password", "")).strip(),
        )

        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
            mounts=_build_proxy_mounts(proxy_url),
        )

    if dify_config.SSRF_PROXY_ALL_URL:
        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
            proxy=dify_config.SSRF_PROXY_ALL_URL,
        )
    elif dify_config.SSRF_PROXY_HTTP_URL and dify_config.SSRF_PROXY_HTTPS_URL:
        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
            mounts={
                "http://": httpx.HTTPTransport(
                        proxy=dify_config.SSRF_PROXY_HTTP_URL, 
                        verify=HTTP_REQUEST_NODE_SSL_VERIFY
                    ),
                "https://": httpx.HTTPTransport(
                        proxy=dify_config.SSRF_PROXY_HTTPS_URL, 
                        verify=HTTP_REQUEST_NODE_SSL_VERIFY
                    ),
            },
        )
    else:
        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
        )


def ssrf_proxy_sse_connect(url: str, **kwargs) -> AbstractContextManager[httpx_sse.EventSource]:
    """Connect to SSE endpoint with SSRF proxy protection.

    This function creates an SSE connection using the configured proxy settings
    to prevent SSRF attacks when connecting to external endpoints. It returns
    a context manager that yields an EventSource object for SSE streaming.

    The function handles HTTP client creation and cleanup automatically, but
    also accepts a pre-configured client via kwargs.

    Args:
        url (str): The SSE endpoint URL to connect to
        **kwargs: Additional arguments passed to the SSE connection, including:
            - client (httpx.Client, optional): Pre-configured HTTP client.
              If not provided, one will be created with SSRF protection.
            - method (str, optional): HTTP method to use, defaults to "GET"
            - headers (dict, optional): HTTP headers to include in the request
            - timeout (httpx.Timeout, optional): Timeout configuration for the connection

    Returns:
        AbstractContextManager[httpx_sse.EventSource]: A context manager that yields an EventSource
        object for SSE streaming. The EventSource provides access to server-sent events.

    Example:
        ```python
        with ssrf_proxy_sse_connect(url, headers=headers) as event_source:
            for sse in event_source.iter_sse():
                print(sse.event, sse.data)
        ```

    Note:
        If a client is not provided in kwargs, one will be automatically created
        with SSRF protection based on the application's configuration. If an
        exception occurs during connection, any automatically created client
        will be cleaned up automatically.
    """

    # Extract client if provided, otherwise create one
    client = kwargs.pop("client", None)
    if client is None:
        # Create client with SSRF proxy configuration
        timeout = kwargs.pop(
            "timeout",
            httpx.Timeout(
                timeout=dify_config.SSRF_DEFAULT_TIME_OUT,
                connect=dify_config.SSRF_DEFAULT_CONNECT_TIME_OUT,
                read=dify_config.SSRF_DEFAULT_READ_TIME_OUT,
                write=dify_config.SSRF_DEFAULT_WRITE_TIME_OUT,
            ),
        )
        headers = kwargs.pop("headers", {})
        client = create_ssrf_proxy_mcp_http_client(headers=headers, timeout=timeout)
        client_provided = False
    else:
        client_provided = True

    # Extract method if provided, default to GET
    method = kwargs.pop("method", "GET")

    try:
        return connect_sse(client, method, url, **kwargs)
    except Exception:
        # If we created the client, we need to clean it up on error
        if not client_provided:
            client.close()
        raise


def create_mcp_error_response(
    request_id: int | str | None, code: int, message: str, data=None
) -> Generator[bytes, None, None]:
    """Create MCP error response"""
    error_data = ErrorData(code=code, message=message, data=data)
    json_response = JSONRPCError(
        jsonrpc="2.0",
        id=request_id or 1,
        error=error_data,
    )
    json_data = json.dumps(jsonable_encoder(json_response))
    sse_content = json_data.encode()
    yield sse_content
