"""The network policy trace providers run under.

HTTP goes through the SSRF proxy owner without retries or redirects, with a
bounded response. gRPC cannot traverse the SSRF proxy (it only tunnels to
port 443), so channels are opened directly to a resolved and pinned address
after rejecting loopback, link-local, and other non-routable destinations.
Private networks stay reachable for VPC collector endpoints.
"""

import ipaddress
import socket
from collections.abc import Mapping
from typing import override
from urllib.parse import urlsplit

import grpc  # type: ignore[import-untyped]
import httpx
from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.errors import EgressBlockedError, EgressError
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, attach, detach, set_value

from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.tracing.request_log_protection import protect_http_request_logs

MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_GRPC_MAX_RECEIVE_BYTES = 4 * 1024 * 1024


def _blocked_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return (
        address.is_loopback
        or address.is_link_local
        or address.is_unspecified
        or address.is_multicast
        or address.is_reserved
    )


class SSRFEgress(Egress):
    @override
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        content: bytes | None,
        timeout: float,
        sensitive_url: bool,
    ) -> EgressResponse:
        # Bounded buffering needs identity bodies, whatever encodings an SDK offers.
        request_headers = {name: value for name, value in headers.items() if name.lower() != "accept-encoding"}
        request_headers["Accept-Encoding"] = "identity"
        if not any(name.lower() == "cookie" for name in request_headers):
            # The shared SSRF client keeps a cookie jar; an explicit header keeps other tenants' cookies out.
            request_headers["Cookie"] = ""
        # Export calls must not be traced by Dify's own instrumentation.
        token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
        try:
            with protect_http_request_logs(sensitive_url):
                response = self._send(method, url, request_headers, content, timeout)
        finally:
            detach(token)
        return EgressResponse(
            status_code=response.status_code,
            headers={name.lower(): value for name, value in response.headers.items()},
            content=response.content,
        )

    @staticmethod
    def _send(method: str, url: str, headers: dict[str, str], content: bytes | None, timeout: float) -> httpx.Response:
        # Raise outside the original handler so no credential-bearing exception is chained.
        failure: EgressError | None = None
        response: httpx.Response | None = None
        try:
            streamed = ssrf_proxy.make_request(
                method,
                url,
                max_retries=0,
                stream_response=True,
                timeout=timeout,
                follow_redirects=False,
                headers=headers,
                content=content,
            )
            response = ssrf_proxy.buffer_response(streamed, max_response_bytes=MAX_RESPONSE_BYTES)
        except ToolSSRFError:
            failure = EgressBlockedError("Destination blocked by the SSRF policy")
        except httpx.ProxyError as error:
            # The SSRF proxy refuses a disallowed HTTPS tunnel with 403 before anything is sent.
            if "403" in str(error):
                failure = EgressBlockedError("Destination blocked by the SSRF policy")
            else:
                failure = EgressError("SSRF proxy unavailable", request_sent=False)
        except (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.PoolTimeout,
            httpx.UnsupportedProtocol,
            httpx.LocalProtocolError,
        ):
            failure = EgressError("Destination unreachable", request_sent=False)
        except (httpx.TransportError, ssrf_proxy.ResponseLimitError):
            failure = EgressError("Transport failed after the request was sent", request_sent=True)
        except ValueError:
            # Request construction rejects malformed input before sending; its message may quote the URL.
            failure = EgressError("Request could not be built", request_sent=False)
        if failure is not None:
            raise failure
        if response is None:
            raise EgressError("Transport returned no response", request_sent=True)
        return response

    @override
    def grpc_channel(self, endpoint: str) -> grpc.Channel:
        parsed = urlsplit(endpoint)
        host = parsed.hostname
        if parsed.scheme not in {"http", "https"} or not host or parsed.username or parsed.password:
            raise EgressBlockedError("Invalid gRPC endpoint")
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            resolved = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except (OSError, ValueError):
            raise EgressError("gRPC endpoint could not be resolved", request_sent=False) from None
        addresses = [ipaddress.ip_address(item[4][0]) for item in resolved]
        if not addresses or any(_blocked_address(address) for address in addresses):
            raise EgressBlockedError("gRPC endpoint resolves to a disallowed address")
        # Pin the checked address so a second DNS answer cannot redirect the channel.
        pinned = addresses[0]
        target = f"[{pinned}]:{port}" if pinned.version == 6 else f"{pinned}:{port}"
        authority = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
        options = [
            ("grpc.enable_retries", 0),
            ("grpc.max_receive_message_length", _GRPC_MAX_RECEIVE_BYTES),
            ("grpc.default_authority", authority),
        ]
        if parsed.scheme == "http":
            return grpc.insecure_channel(target, options=options)
        options.append(("grpc.ssl_target_name_override", host))
        return grpc.secure_channel(target, grpc.ssl_channel_credentials(), options=options)
