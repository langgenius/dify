"""
Proxy requests to avoid SSRF
"""

import logging
import time

import httpx

from configs import dify_config

SSRF_DEFAULT_MAX_RETRIES = dify_config.SSRF_DEFAULT_MAX_RETRIES

HTTP_REQUEST_NODE_SSL_VERIFY = True  # Default value for HTTP_REQUEST_NODE_SSL_VERIFY is True
try:
    HTTP_REQUEST_NODE_SSL_VERIFY = dify_config.HTTP_REQUEST_NODE_SSL_VERIFY
    http_request_node_ssl_verify_lower = str(HTTP_REQUEST_NODE_SSL_VERIFY).lower()
    if http_request_node_ssl_verify_lower == "true":
        HTTP_REQUEST_NODE_SSL_VERIFY = True
    elif http_request_node_ssl_verify_lower == "false":
        HTTP_REQUEST_NODE_SSL_VERIFY = False
    else:
        raise ValueError("Invalid value. HTTP_REQUEST_NODE_SSL_VERIFY should be 'True' or 'False'")
except NameError:
    HTTP_REQUEST_NODE_SSL_VERIFY = True

BACKOFF_FACTOR = 0.5
STATUS_FORCELIST = [429, 500, 502, 503, 504]


class MaxRetriesExceededError(ValueError):
    """Raised when the maximum number of retries is exceeded."""

    pass


def make_request(method, url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    if "allow_redirects" in kwargs:
        allow_redirects = kwargs.pop("allow_redirects")
        if "follow_redirects" not in kwargs:
            kwargs["follow_redirects"] = allow_redirects

    if "timeout" not in kwargs:
        kwargs["timeout"] = httpx.Timeout(
            timeout=dify_config.SSRF_DEFAULT_TIME_OUT,
            connect=dify_config.SSRF_DEFAULT_CONNECT_TIME_OUT,
            read=dify_config.SSRF_DEFAULT_READ_TIME_OUT,
            write=dify_config.SSRF_DEFAULT_WRITE_TIME_OUT,
        )

    if "ssl_verify" not in kwargs:
        kwargs["ssl_verify"] = HTTP_REQUEST_NODE_SSL_VERIFY

    ssl_verify = kwargs.pop("ssl_verify")

    retries = 0
    while retries <= max_retries:
        try:
            if dify_config.SSRF_PROXY_ALL_URL:
                with httpx.Client(proxy=dify_config.SSRF_PROXY_ALL_URL, verify=ssl_verify) as client:
                    response = client.request(method=method, url=url, **kwargs)
            elif dify_config.SSRF_PROXY_HTTP_URL and dify_config.SSRF_PROXY_HTTPS_URL:
                proxy_mounts = {
                    "http://": httpx.HTTPTransport(proxy=dify_config.SSRF_PROXY_HTTP_URL, verify=ssl_verify),
                    "https://": httpx.HTTPTransport(proxy=dify_config.SSRF_PROXY_HTTPS_URL, verify=ssl_verify),
                }
                with httpx.Client(mounts=proxy_mounts, verify=ssl_verify) as client:
                    response = client.request(method=method, url=url, **kwargs)
            else:
                with httpx.Client(verify=ssl_verify) as client:
                    response = client.request(method=method, url=url, **kwargs)

            if response.status_code not in STATUS_FORCELIST:
                return response
            else:
                logging.warning(f"Received status code {response.status_code} for URL {url} which is in the force list")

        except httpx.RequestError as e:
            logging.warning(f"Request to URL {url} failed on attempt {retries + 1}: {e}")
            if max_retries == 0:
                raise

        retries += 1
        if retries <= max_retries:
            time.sleep(BACKOFF_FACTOR * (2 ** (retries - 1)))
    raise MaxRetriesExceededError(f"Reached maximum retries ({max_retries}) for URL {url}")


def get(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("GET", url, max_retries=max_retries, **kwargs)


def post(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("POST", url, max_retries=max_retries, **kwargs)


def put(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("PUT", url, max_retries=max_retries, **kwargs)


def patch(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("PATCH", url, max_retries=max_retries, **kwargs)


def delete(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("DELETE", url, max_retries=max_retries, **kwargs)


def head(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("HEAD", url, max_retries=max_retries, **kwargs)


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
    except Exception as e:
        # If we created the client, we need to clean it up on error
        if not client_provided:
            client.close()
        raise
