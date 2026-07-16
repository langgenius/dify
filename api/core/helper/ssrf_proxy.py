"""SSRF-protected HTTP client for generic outbound requests.

Use this module when the URL represents a normal external HTTP interaction that
must go through network/proxy policy exactly as requested, such as HTTP Request
nodes, provider/API integrations, auth discovery, or custom tool calls.

Do not use this directly for "remote file" retrieval. File downloads, probes,
and metadata checks should use `core.file.remote_fetcher` instead so Dify-signed
file URLs can be resolved through DB + storage before falling back to this SSRF
client.
"""

import logging
import time
from typing import Any

import httpx
from pydantic import TypeAdapter, ValidationError

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client
from core.tools.errors import ToolSSRFError
from graphon.http.response import HttpResponse

logger = logging.getLogger(__name__)

SSRF_DEFAULT_MAX_RETRIES = dify_config.SSRF_DEFAULT_MAX_RETRIES

BACKOFF_FACTOR = 0.5
STATUS_FORCELIST = [429, 500, 502, 503, 504]

type Headers = dict[str, str]
_HEADERS_ADAPTER: TypeAdapter[Headers] = TypeAdapter(Headers)

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


class ResponseLimitError(ValueError):
    """Base error for responses that cannot be safely bounded."""

    pass


class ResponseTooLargeError(ResponseLimitError):
    """Raised when an identity response exceeds the configured byte limit."""

    pass


class UnsupportedResponseEncodingError(ResponseLimitError):
    """Raised when response encoding prevents safe decoded-size enforcement."""

    pass


request_error = httpx.RequestError
max_retries_exceeded_error = MaxRetriesExceededError


def _create_proxy_mounts(verify: bool) -> dict[str, httpx.HTTPTransport]:
    """Build per-scheme proxy transports with the same TLS policy as the SSRF client."""
    return {
        "http://": httpx.HTTPTransport(
            proxy=dify_config.SSRF_PROXY_HTTP_URL,
            verify=verify,
        ),
        "https://": httpx.HTTPTransport(
            proxy=dify_config.SSRF_PROXY_HTTPS_URL,
            verify=verify,
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
            mounts=_create_proxy_mounts(verify=verify),
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


def _get_user_provided_host_header(headers: Headers | None) -> str | None:
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


def _inject_trace_headers(headers: Headers | None) -> Headers:
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


def make_request(
    method: str,
    url: str,
    max_retries: int = SSRF_DEFAULT_MAX_RETRIES,
    max_response_bytes: int | None = None,
    stream_response: bool = False,
    **kwargs: Any,
) -> httpx.Response:
    """Send one SSRF-protected request with optional buffering and size limits.

    When ``max_response_bytes`` is set, identity responses are read incrementally
    and rejected before more than that many bytes are retained in memory. Encoded
    responses are rejected before body reads because their decoded size cannot be
    bounded by httpx without first allocating a decoded chunk.

    Args:
        method: HTTP method sent through the configured SSRF client.
        url: Absolute request URL.
        max_retries: Number of retry attempts after the initial request.
        max_response_bytes: Optional maximum bytes retained from an identity response.
        stream_response: Return an open streaming response that the caller must close.
        **kwargs: Additional keyword arguments forwarded to ``httpx.Client``.

    Returns:
        A buffered response, or an open response when ``stream_response`` is true.
        Size-limited responses have decoded transfer headers removed.

    Raises:
        ResponseLimitError: The response exceeds the limit or uses a non-identity encoding.
        ToolSSRFError: The configured SSRF proxy rejects the destination.
        MaxRetriesExceededError: All configured request attempts fail.
        httpx.RequestError: A request fails while retries are disabled.
        ValueError: The response options, limit, or request headers are invalid.
    """
    if max_response_bytes is not None and max_response_bytes <= 0:
        raise ValueError("max_response_bytes must be positive")
    if stream_response and max_response_bytes is not None:
        raise ValueError("stream_response cannot be combined with max_response_bytes")

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
    if not isinstance(verify_option, bool):
        raise ValueError("ssl_verify must be a boolean")
    client = _get_ssrf_client(verify_option)

    # Inject traceparent header for distributed tracing (when OTEL is not enabled)
    try:
        headers: Headers = _HEADERS_ADAPTER.validate_python(kwargs.get("headers") or {})
    except ValidationError as e:
        raise ValueError("headers must be a mapping of string keys to string values") from e
    headers = _inject_trace_headers(headers)
    kwargs["headers"] = headers

    # Preserve user-provided Host header
    # When using a forward proxy, httpx may override the Host header based on the URL.
    # We extract and preserve any explicitly set Host header to support virtual hosting.
    user_provided_host = _get_user_provided_host_header(headers)
    stream_send_kwargs: dict[str, Any] = {}
    if stream_response:
        if "auth" in kwargs:
            stream_send_kwargs["auth"] = kwargs.pop("auth")
        if "follow_redirects" in kwargs:
            stream_send_kwargs["follow_redirects"] = kwargs.pop("follow_redirects")

    retries = 0
    while retries <= max_retries:
        try:
            # Preserve the user-provided Host header
            # httpx may override the Host header when using a proxy
            headers = {k: v for k, v in headers.items() if k.lower() != "host"}
            if user_provided_host is not None:
                headers["host"] = user_provided_host
            kwargs["headers"] = headers
            if stream_response:
                request = client.build_request(method=method, url=url, **kwargs)
                response = client.send(request, stream=True, **stream_send_kwargs)
            elif max_response_bytes is None:
                response = client.request(method=method, url=url, **kwargs)
            else:
                with client.stream(method=method, url=url, **kwargs) as streaming_response:
                    content_encoding = streaming_response.headers.get("content-encoding", "identity").strip().lower()
                    if content_encoding not in {"", "identity"}:
                        raise UnsupportedResponseEncodingError(
                            f"content encoding {content_encoding} cannot be safely bounded"
                        )
                    content = bytearray()
                    for chunk in streaming_response.iter_bytes():
                        if len(content) + len(chunk) > max_response_bytes:
                            raise ResponseTooLargeError(f"response exceeded {max_response_bytes} bytes")
                        content.extend(chunk)
                    decoded_headers = {
                        name: value
                        for name, value in streaming_response.headers.items()
                        if name.lower() not in {"content-encoding", "content-length", "transfer-encoding"}
                    }
                    response = httpx.Response(
                        streaming_response.status_code,
                        headers=decoded_headers,
                        content=bytes(content),
                        request=streaming_response.request,
                        extensions=streaming_response.extensions,
                        history=streaming_response.history,
                        default_encoding=streaming_response.default_encoding,
                    )

            # Check for SSRF protection by Squid proxy
            if response.status_code in (401, 403):
                # Check if this is a Squid SSRF rejection
                server_header = response.headers.get("server", "").lower()
                via_header = response.headers.get("via", "").lower()

                # Squid typically identifies itself in Server or Via headers
                if "squid" in server_header or "squid" in via_header:
                    response.close()
                    raise ToolSSRFError(
                        f"Access to '{url}' was blocked by SSRF protection. "
                        f"The URL may point to a private or local network address. "
                    )

            if response.status_code not in STATUS_FORCELIST or max_retries == 0:
                return response
            else:
                logger.warning(
                    "Received status code %s for URL %s which is in the force list",
                    response.status_code,
                    url,
                )
                response.close()

        except httpx.RequestError as e:
            logger.warning("Request to URL %s failed on attempt %s: %s", url, retries + 1, e)
            if max_retries == 0:
                raise

        retries += 1
        if retries <= max_retries:
            time.sleep(BACKOFF_FACTOR * (2 ** (retries - 1)))
    raise MaxRetriesExceededError(f"Reached maximum retries ({max_retries}) for URL {url}")


def get(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return make_request("GET", url, max_retries=max_retries, **kwargs)


def post(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return make_request("POST", url, max_retries=max_retries, **kwargs)


def put(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return make_request("PUT", url, max_retries=max_retries, **kwargs)


def patch(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return make_request("PATCH", url, max_retries=max_retries, **kwargs)


def delete(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return make_request("DELETE", url, max_retries=max_retries, **kwargs)


def head(url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
    return make_request("HEAD", url, max_retries=max_retries, **kwargs)


class SSRFProxy:
    """
    Adapter exposing SSRF-protected HTTP helpers behind HttpClientProtocol.

    This is intentionally a thin wrapper over the existing module-level functions so callers can inject it
    where a protocol-typed HTTP client is expected.
    """

    @property
    def max_retries_exceeded_error(self) -> type[Exception]:
        return max_retries_exceeded_error

    @property
    def request_error(self) -> type[Exception]:
        return request_error

    def get(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
        return get(url=url, max_retries=max_retries, **kwargs)

    def head(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
        return head(url=url, max_retries=max_retries, **kwargs)

    def post(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
        return post(url=url, max_retries=max_retries, **kwargs)

    def put(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
        return put(url=url, max_retries=max_retries, **kwargs)

    def delete(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
        return delete(url=url, max_retries=max_retries, **kwargs)

    def patch(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> httpx.Response:
        return patch(url=url, max_retries=max_retries, **kwargs)


def _to_graphon_http_response(response: httpx.Response) -> HttpResponse:
    """Convert an ``httpx`` response into Graphon's transport-agnostic wrapper."""
    return HttpResponse(
        status_code=response.status_code,
        headers=dict(response.headers),
        content=response.content,
        url=str(response.url) if response.url else None,
        reason_phrase=response.reason_phrase,
        fallback_text=response.text,
    )


class GraphonSSRFProxy:
    """Adapter exposing SSRF helpers behind Graphon's ``HttpClientProtocol``."""

    @property
    def max_retries_exceeded_error(self) -> type[Exception]:
        return max_retries_exceeded_error

    @property
    def request_error(self) -> type[Exception]:
        return request_error

    def get(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> HttpResponse:
        return _to_graphon_http_response(get(url=url, max_retries=max_retries, **kwargs))

    def head(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> HttpResponse:
        return _to_graphon_http_response(head(url=url, max_retries=max_retries, **kwargs))

    def post(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> HttpResponse:
        return _to_graphon_http_response(post(url=url, max_retries=max_retries, **kwargs))

    def put(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> HttpResponse:
        return _to_graphon_http_response(put(url=url, max_retries=max_retries, **kwargs))

    def delete(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> HttpResponse:
        return _to_graphon_http_response(delete(url=url, max_retries=max_retries, **kwargs))

    def patch(self, url: str, max_retries: int = SSRF_DEFAULT_MAX_RETRIES, **kwargs: Any) -> HttpResponse:
        return _to_graphon_http_response(patch(url=url, max_retries=max_retries, **kwargs))


ssrf_proxy = SSRFProxy()
graphon_ssrf_proxy = GraphonSSRFProxy()
