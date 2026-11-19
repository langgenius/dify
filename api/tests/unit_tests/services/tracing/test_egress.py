import socket
from collections.abc import Callable
from dataclasses import dataclass

import httpx
import pytest
from dify_trace_sdk.errors import EgressBlockedError, EgressError

from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from services.tracing.egress import MAX_RESPONSE_BYTES, SSRFEgress


@dataclass(frozen=True)
class _ProxyCall:
    max_retries: int
    stream_response: bool
    timeout: float
    follow_redirects: bool
    headers: dict[str, str]


class _ProxyCalls:
    """Stands in for the SSRF proxy owner's ``make_request``."""

    def __init__(self, outcome: httpx.Response | Exception) -> None:
        self.outcome = outcome
        self.calls: list[_ProxyCall] = []

    def __call__(
        self,
        method: str,
        url: str,
        *,
        max_retries: int,
        stream_response: bool,
        timeout: float,
        follow_redirects: bool,
        headers: dict[str, str],
        content: bytes | None,
    ) -> httpx.Response:
        del method, url, content
        self.calls.append(
            _ProxyCall(
                max_retries=max_retries,
                stream_response=stream_response,
                timeout=timeout,
                follow_redirects=follow_redirects,
                headers=headers,
            )
        )
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _request(egress: SSRFEgress, headers: dict[str, str]) -> None:
    egress.request(
        "POST",
        "https://collector.example.com/v1/traces",
        headers=headers,
        content=b"{}",
        timeout=5.0,
        sensitive_url=False,
    )


def test_requests_go_through_the_proxy_without_retries_redirects_or_ambient_cookies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxy = _ProxyCalls(httpx.Response(202, headers={"Content-Type": "application/json"}, content=b'{"ok": true}'))
    monkeypatch.setattr(ssrf_proxy, "make_request", proxy)

    result = SSRFEgress().request(
        "POST",
        "https://collector.example.com/v1/traces",
        headers={"Authorization": "Bearer token"},
        content=b"{}",
        timeout=5.0,
        sensitive_url=False,
    )

    assert (result.status_code, result.json(), result.headers["content-type"]) == (
        202,
        {"ok": True},
        "application/json",
    )
    (call,) = proxy.calls
    assert (call.max_retries, call.follow_redirects, call.stream_response, call.timeout) == (0, False, True, 5.0)
    assert call.headers["Accept-Encoding"] == "identity"
    assert call.headers["Cookie"] == ""
    assert call.headers["Authorization"] == "Bearer token"


def test_sdk_encodings_are_replaced_but_provider_cookies_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    proxy = _ProxyCalls(httpx.Response(200, content=b""))
    monkeypatch.setattr(ssrf_proxy, "make_request", proxy)

    _request(SSRFEgress(), {"accept-encoding": "gzip, deflate, br", "cookie": "session=mine"})

    headers = proxy.calls[0].headers
    assert "accept-encoding" not in headers
    assert headers["Accept-Encoding"] == "identity"
    assert "Cookie" not in headers
    assert headers["cookie"] == "session=mine"


@pytest.mark.parametrize(
    ("failure", "blocked"),
    [(httpx.ProxyError("403 Forbidden"), True), (httpx.ProxyError("502 Bad Gateway"), False)],
)
def test_proxy_refusals_are_never_sent(monkeypatch: pytest.MonkeyPatch, failure: Exception, blocked: bool) -> None:
    monkeypatch.setattr(ssrf_proxy, "make_request", _ProxyCalls(failure))

    with pytest.raises(EgressError) as raised:
        _request(SSRFEgress(), {})

    assert isinstance(raised.value, EgressBlockedError) is blocked
    assert raised.value.request_sent is False


@pytest.mark.parametrize(
    ("failure", "expected", "request_sent"),
    [
        (ToolSSRFError("blocked"), EgressBlockedError, False),
        (httpx.ConnectError("refused"), EgressError, False),
        (httpx.ConnectTimeout("slow dns"), EgressError, False),
        (httpx.PoolTimeout("pool exhausted"), EgressError, False),
        (httpx.ReadTimeout("slow body"), EgressError, True),
        (httpx.RemoteProtocolError("reset"), EgressError, True),
    ],
)
def test_transport_failures_tell_whether_the_request_was_sent(
    monkeypatch: pytest.MonkeyPatch, failure: Exception, expected: type[EgressError], request_sent: bool
) -> None:
    monkeypatch.setattr(ssrf_proxy, "make_request", _ProxyCalls(failure))

    with pytest.raises(expected) as raised:
        _request(SSRFEgress(), {})

    assert raised.value.request_sent is request_sent
    assert raised.value.__cause__ is None
    assert raised.value.__context__ is None


def test_oversized_responses_count_as_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ssrf_proxy, "make_request", _ProxyCalls(httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)))
    )

    with pytest.raises(EgressError) as raised:
        _request(SSRFEgress(), {})

    assert raised.value.request_sent is True


def _resolve_to(address: str) -> Callable[..., list[tuple[object, ...]]]:
    def resolve(host: str, port: int, type: int = 0) -> list[tuple[object, ...]]:
        del host
        return [(socket.AF_INET6 if ":" in address else socket.AF_INET, type, 6, "", (address, port))]

    return resolve


@pytest.mark.parametrize("address", ["127.0.0.1", "169.254.169.254", "0.0.0.0", "::1", "::ffff:127.0.0.1"])
def test_grpc_channels_refuse_non_routable_destinations(monkeypatch: pytest.MonkeyPatch, address: str) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _resolve_to(address))

    with pytest.raises(EgressBlockedError):
        SSRFEgress().grpc_channel("https://collector.example.com:4317")


def test_grpc_channels_allow_private_collectors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _resolve_to("10.0.0.8"))

    channel = SSRFEgress().grpc_channel("http://collector.internal:4317")

    channel.close()


@pytest.mark.parametrize(
    "endpoint", ["ftp://collector.example.com", "https://user:pass@collector.example.com", "https://"]
)
def test_grpc_channels_reject_malformed_endpoints(endpoint: str) -> None:
    with pytest.raises(EgressBlockedError):
        SSRFEgress().grpc_channel(endpoint)


def test_unresolvable_grpc_hosts_are_transient(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(host: str, port: int, type: int = 0) -> list[tuple[object, ...]]:
        del host, port, type
        raise socket.gaierror("no such host")

    monkeypatch.setattr(socket, "getaddrinfo", fail)

    with pytest.raises(EgressError) as raised:
        SSRFEgress().grpc_channel("https://collector.example.com")

    assert not isinstance(raised.value, EgressBlockedError)
    assert raised.value.request_sent is False
