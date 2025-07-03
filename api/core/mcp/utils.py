import httpx

from configs import dify_config

SSRF_DEFAULT_MAX_RETRIES = dify_config.SSRF_DEFAULT_MAX_RETRIES

HTTP_REQUEST_NODE_SSL_VERIFY = dify_config.HTTP_REQUEST_NODE_SSL_VERIFY

STATUS_FORCELIST = [429, 500, 502, 503, 504]


def create_ssrf_proxy_mcp_http_client(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
) -> httpx.Client:
    """Create an HTTPX client with SSRF proxy configuration for MCP connections.

    Args:
        headers: Optional headers to include in the client
        timeout: Optional timeout configuration

    Returns:
        Configured httpx.Client with proxy settings
    """
    if dify_config.SSRF_PROXY_ALL_URL:
        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
            proxy=dify_config.SSRF_PROXY_ALL_URL,
        )
    elif dify_config.SSRF_PROXY_HTTP_URL and dify_config.SSRF_PROXY_HTTPS_URL:
        proxy_mounts = {
            "http://": httpx.HTTPTransport(proxy=dify_config.SSRF_PROXY_HTTP_URL, verify=HTTP_REQUEST_NODE_SSL_VERIFY),
            "https://": httpx.HTTPTransport(
                proxy=dify_config.SSRF_PROXY_HTTPS_URL, verify=HTTP_REQUEST_NODE_SSL_VERIFY
            ),
        }
        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
            mounts=proxy_mounts,
        )
    else:
        return httpx.Client(
            verify=HTTP_REQUEST_NODE_SSL_VERIFY,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
        )


def ssrf_proxy_sse_connect(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    """Connect to SSE endpoint with SSRF proxy protection.

    This function creates an SSE connection using the configured proxy settings
    to prevent SSRF attacks when connecting to external endpoints.

    Args:
        url: The SSE endpoint URL
        max_retries: Maximum number of retry attempts
        **kwargs: Additional arguments passed to the SSE connection

    Returns:
        EventSource object for SSE streaming
    """
    from httpx_sse import connect_sse

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
