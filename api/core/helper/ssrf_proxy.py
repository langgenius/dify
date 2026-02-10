"""
Proxy requests to avoid SSRF
"""

import logging
import time

import httpx

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client
from core.tools.errors import ToolSSRFError

logger = logging.getLogger(__name__)

SSRF_DEFAULT_MAX_RETRIES = dify_config.SSRF_DEFAULT_MAX_RETRIES

BACKOFF_FACTOR = 0.5
STATUS_FORCELIST = [429, 500, 502, 503, 504]

_SSL_VERIFIED_POOL_KEY = "ssrf:verified"
_SSL_UNVERIFIED_POOL_KEY = "ssrf:unverified"
_SSRF_CLIENT_LIMITS = httpx.Limits(
    max_connections=dify_config.SSRF_POOL_MAX_CONNECTIONS,
    max_keepalive_connections=dify_config.SSRF_POOL_MAX_KEEPALIVE_CONNECTIONS,
    keepalive_expiry=dify_config.SSRF_POOL_KEEPALIVE_EXPIRY,
)


class MaxRetriesExceededError(ValueError):
    """Raised when the maximum number of retries is exceeded."""

    pass


request_error = httpx.RequestError
max_retries_exceeded_error = MaxRetriesExceededError


def _create_proxy_mounts() -> dict[str, httpx.HTTPTransport]:
    return {
        "http://": httpx.HTTPTransport(
            proxy=dify_config.SSRF_PROXY_HTTP_URL,
        ),
        "https://": httpx.HTTPTransport(
            proxy=dify_config.SSRF_PROXY_HTTPS_URL,
        ),
    }


def _build_ssrf_client(verify: bool) -> httpx.Client:
    if dify_config.SSRF_PROXY_ALL_URL:
        return httpx.Client(
            proxy=dify_config.SSRF_PROXY_ALL_URL,
            verify=verify,
            limits=_SSRF_CLIENT_LIMITS,
        )

    if dify_config.SSRF_PROXY_HTTP_URL and dify_config.SSRF_PROXY_HTTPS_URL:
        return httpx.Client(
            mounts=_create_proxy_mounts(),
            verify=verify,
            limits=_SSRF_CLIENT_LIMITS,
        )

    return httpx.Client(verify=verify, limits=_SSRF_CLIENT_LIMITS)


def _get_ssrf_client(ssl_verify_enabled: bool) -> httpx.Client:
    if not isinstance(ssl_verify_enabled, bool):
        raise ValueError("SSRF client verify flag must be a boolean")

    return get_pooled_http_client(
        _SSL_VERIFIED_POOL_KEY if ssl_verify_enabled else _SSL_UNVERIFIED_POOL_KEY,
        lambda: _build_ssrf_client(verify=ssl_verify_enabled),
    )


def _get_user_provided_host_header(headers: dict | None) -> str | None:
    """
    Extract the user-provided Host header from the headers dict.

    This is needed because when using a forward proxy, httpx may override the Host header.
    We preserve the user's explicit Host header to support virtual hosting and other use cases.
    """
    if not headers:
        return None
    # Case-insensitive lookup for Host header
    for key, value in headers.items():
        if key.lower() == "host":
            return value
    return None


def _inject_trace_headers(headers: dict | None) -> dict:
    """
    Inject W3C traceparent header for distributed tracing.

    When OTEL is enabled, HTTPXClientInstrumentor handles trace propagation automatically.
    When OTEL is disabled, we manually inject the traceparent header.
    """
    if headers is None:
        headers = {}

    # Skip if already present (case-insensitive check)
    for key in headers:
        if key.lower() == "traceparent":
            return headers

    # Skip if OTEL is enabled - HTTPXClientInstrumentor handles this automatically
    if dify_config.ENABLE_OTEL:
        return headers

    # Generate and inject traceparent for non-OTEL scenarios
    try:
        from core.helper.trace_id_helper import generate_traceparent_header

        traceparent = generate_traceparent_header()
        if traceparent:
            headers["traceparent"] = traceparent
    except Exception:
        # Silently ignore errors to avoid breaking requests
        logger.debug("Failed to generate traceparent header", exc_info=True)

    return headers


def make_request(method, url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    # Convert requests-style allow_redirects to httpx-style follow_redirects
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

    # prioritize per-call option, which can be switched on and off inside the HTTP node on the web UI
    verify_option = kwargs.pop("ssl_verify", dify_config.HTTP_REQUEST_NODE_SSL_VERIFY)
    client = _get_ssrf_client(verify_option)

    # Inject traceparent header for distributed tracing (when OTEL is not enabled)
    headers = kwargs.get("headers") or {}
    headers = _inject_trace_headers(headers)
    kwargs["headers"] = headers

    # Preserve user-provided Host header
    # When using a forward proxy, httpx may override the Host header based on the URL.
    # We extract and preserve any explicitly set Host header to support virtual hosting.
    user_provided_host = _get_user_provided_host_header(headers)

    retries = 0
    while retries <= max_retries:
        try:
            # Preserve the user-provided Host header
            # httpx may override the Host header when using a proxy
            headers = {k: v for k, v in headers.items() if k.lower() != "host"}
            if user_provided_host is not None:
                headers["host"] = user_provided_host
            kwargs["headers"] = headers
            response = client.request(method=method, url=url, **kwargs)

            # Check for SSRF protection by Squid proxy
            if response.status_code in (401, 403):
                # Check if this is a Squid SSRF rejection
                server_header = response.headers.get("server", "").lower()
                via_header = response.headers.get("via", "").lower()

                # Squid typically identifies itself in Server or Via headers
                if "squid" in server_header or "squid" in via_header:
                    raise ToolSSRFError(
                        f"Access to '{url}' was blocked by SSRF protection. "
                        f"The URL may point to a private or local network address. "
                    )

            if response.status_code not in STATUS_FORCELIST:
                return response
            else:
                logger.warning(
                    "Received status code %s for URL %s which is in the force list",
                    response.status_code,
                    url,
                )

        except httpx.RequestError as e:
            logger.warning("Request to URL %s failed on attempt %s: %s", url, retries + 1, e)
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
