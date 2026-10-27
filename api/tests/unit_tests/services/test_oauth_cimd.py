import gzip
import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import timedelta

import httpx
import pytest

import services.oauth_cimd as cimd_module
from core.helper.ssrf_proxy import ResponseDeadlineError, ResponseLimitError
from enums.oauth_client import OAuthClientKind
from libs.oauth_bearer import sha256_hex
from services.oauth_cimd import (
    CIMD_CACHE_MAX_SECONDS,
    CIMD_CACHE_MIN_SECONDS,
    CIMD_FETCH_INTERVAL_SECONDS,
    CIMD_MAX_BYTES,
    CIMD_STALE_SECONDS,
    CIMD_TIMEOUT_SECONDS,
    CIMD_TOTAL_DEADLINE_SECONDS,
    CimdClientSource,
    CimdFetchError,
    CimdResponse,
    cimd_storage_id,
    fetch_client_metadata,
    resolve_host_addresses,
)
from services.oauth_token_contracts import GrantType

URL = "https://agent.example/oauth/client.json"
REDIRECT = "https://agent.example/cb"
PUBLIC_IP = "93.184.216.34"


def _document(**overrides: object) -> dict[str, object]:
    document: dict[str, object] = {"client_id": URL, "client_name": "Agent", "redirect_uris": [REDIRECT]}
    document.update(overrides)
    return {key: value for key, value in document.items() if value is not None}


def _response(document: object, max_age: int | None = None) -> CimdResponse:
    return CimdResponse(body=json.dumps(document).encode(), max_age=max_age)


@dataclass
class _Cache:
    data: dict[str, str] = field(default_factory=dict)
    ttls: dict[str, int | timedelta] = field(default_factory=dict)
    fetch_slots: set[str] = field(default_factory=set)

    def get(self, name: str) -> str | bytes | None:
        return self.data.get(name)

    def setex(self, name: str, time: int | timedelta, value: str | bytes) -> object:
        self.data[name] = value if isinstance(value, str) else value.decode()
        self.ttls[name] = time
        return True

    def set(self, name: str, value: str, *, nx: bool, ex: int) -> bool | None:
        _ = value
        assert nx
        if name in self.fetch_slots:
            return None
        self.fetch_slots.add(name)
        self.ttls[name] = ex
        return True

    def expire_throttle(self) -> None:
        self.fetch_slots.clear()

    def expire_cache(self) -> None:
        self.data.clear()


@dataclass
class _Fetcher:
    responses: list[CimdResponse | Exception]
    urls: list[str] = field(default_factory=list)

    def __call__(self, url: str) -> CimdResponse:
        self.urls.append(url)
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@dataclass
class _Resolver:
    addresses: dict[str, Sequence[str]] = field(default_factory=dict)
    default: Sequence[str] = (PUBLIC_IP,)
    hosts: list[str] = field(default_factory=list)

    def __call__(self, host: str) -> Sequence[str]:
        self.hosts.append(host)
        return self.addresses.get(host, self.default)


@dataclass
class _Clock:
    seconds: float = 1_000_000.0

    def __call__(self) -> float:
        return self.seconds

    def advance(self, seconds: float) -> None:
        self.seconds += seconds


@dataclass
class _World:
    source: CimdClientSource
    cache: _Cache
    fetcher: _Fetcher
    resolver: _Resolver
    clock: _Clock


def _world(*responses: CimdResponse | Exception, resolver: _Resolver | None = None) -> _World:
    clock = _Clock()
    cache = _Cache()
    fetcher = _Fetcher(list(responses))
    the_resolver = resolver or _Resolver()
    source = CimdClientSource(cache=cache, fetch=fetcher, resolve_host=the_resolver, now=clock)
    return _World(source=source, cache=cache, fetcher=fetcher, resolver=the_resolver, clock=clock)


def test_valid_document_resolves_to_a_public_client() -> None:
    world = _world(_response(_document(logo_uri="https://agent.example/logo.png")))

    client = world.source.resolve(URL)

    assert client is not None
    assert client.client_id == URL
    assert client.storage_client_id == cimd_storage_id(URL)
    assert client.kind == OAuthClientKind.PUBLIC
    assert client.secret_hash is None
    assert client.display_name == "Agent"
    assert client.logo_uri == "https://agent.example/logo.png"
    assert client.redirect_uris == (REDIRECT,)
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN})
    assert world.fetcher.urls == [URL]


def test_storage_id_is_stable_and_fits_the_client_id_columns() -> None:
    assert cimd_storage_id(URL) == "cimd:" + sha256_hex(URL)[:32]
    assert cimd_storage_id(URL) == cimd_storage_id(URL)
    assert cimd_storage_id(URL) != cimd_storage_id(URL + "x")
    assert len(cimd_storage_id("https://x.example/" + "a" * 1500)) <= 64


def test_name_defaults_to_the_host_and_logo_without_https_is_dropped() -> None:
    world = _world(_response(_document(client_name=None, logo_uri="http://agent.example/logo.png")))

    client = world.source.resolve(URL)

    assert client is not None
    assert client.display_name == "agent.example"
    assert client.logo_uri is None


def test_unknown_fields_and_unknown_grant_types_are_ignored() -> None:
    grants = ["authorization_code", "urn:future:grant", "refresh_token", "implicit"]
    world = _world(_response(_document(grant_types=grants, brand_new_field={"a": 1}, jwks_uri="https://x.example/k")))

    client = world.source.resolve(URL)

    assert client is not None
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN})


def test_device_grant_in_the_document_is_not_granted() -> None:
    grants = ["authorization_code", GrantType.DEVICE_CODE.value]
    world = _world(_response(_document(grant_types=grants)))

    client = world.source.resolve(URL)

    assert client is not None
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE})


@pytest.mark.parametrize("grants", [["refresh_token"], ["implicit"], []])
def test_grant_types_without_authorization_code_are_rejected(grants: list[str]) -> None:
    world = _world(_response(_document(grant_types=grants)))

    assert world.source.resolve(URL) is None


@pytest.mark.parametrize(
    "document",
    [
        _document(client_id="https://agent.example/other.json"),
        _document(client_id=None),
        _document(redirect_uris=None),
        _document(redirect_uris=[]),
        _document(redirect_uris="https://agent.example/cb"),
        _document(redirect_uris=[7]),
        _document(redirect_uris=["http://agent.example/cb"]),
        _document(redirect_uris=["javascript:alert(1)"]),
        _document(redirect_uris=[f"https://agent.example/cb{i}" for i in range(11)]),
        _document(redirect_uris=["https://" + "a" * 254 + ".example/cb"]),
        _document(token_endpoint_auth_method="client_secret_basic"),
        _document(token_endpoint_auth_method="private_key_jwt"),
        _document(client_secret="s3cret"),
        _document(client_secret_expires_at=0),
        _document(client_name="n" * 256),
        _document(client_name=5),
        _document(grant_types="authorization_code"),
        ["not", "an", "object"],
        "just a string",
    ],
)
def test_invalid_documents_are_rejected(document: object) -> None:
    world = _world(_response(document))

    assert world.source.resolve(URL) is None


def test_auth_method_none_is_accepted() -> None:
    world = _world(_response(_document(token_endpoint_auth_method="none")))

    assert world.source.resolve(URL) is not None


def test_non_json_body_is_rejected() -> None:
    world = _world(CimdResponse(body=b"<html>nope</html>", max_age=None))

    assert world.source.resolve(URL) is None


def test_a_fetch_error_resolves_to_none() -> None:
    world = _world(CimdFetchError("boom"))

    assert world.source.resolve(URL) is None


@pytest.mark.parametrize(
    "client_id",
    [
        "http://agent.example/c.json",
        "ftp://agent.example/c.json",
        "HTTPS://agent.example/c.json",
        "https://agent.example",
        "https://agent.example?x=1",
        "https://agent.example/a/../c.json",
        "https://agent.example/a/./c.json",
        "https://agent.example/a/%2e%2e/c.json",
        "https://agent.example/c.json#frag",
        "https://user@agent.example/c.json",
        "https://user:pw@agent.example/c.json",
        "https:///c.json",
        "https://agent.example:notaport/c.json",
        "https://agent.example/c json",
        "https://agent.example/c.json\n",
        "https://agent.example/" + "a" * 2100,
        "https://\u2603.ws/x",
        "https://agent.example/caf\u00e9",
        "https://\uff10\uff11\uff12.example/x",
    ],
)
def test_client_id_rules_reject_without_a_fetch_or_a_lookup(client_id: str) -> None:
    world = _world(_response(_document(client_id=client_id)))

    assert world.source.resolve(client_id) is None
    assert world.fetcher.urls == []
    assert world.resolver.hosts == []


@pytest.mark.parametrize(
    "client_id",
    ["https://agent.example:8443/c.json", "https://agent.example/c.json?v=2", "https://agent.example/"],
)
def test_port_query_and_bare_slash_path_are_allowed(client_id: str) -> None:
    world = _world(_response(_document(client_id=client_id)))

    assert world.source.resolve(client_id) is not None


@pytest.mark.parametrize(
    "client_id",
    [
        "https://10.0.0.1/x",
        "https://127.0.0.1/x",
        "https://169.254.169.254/latest/meta-data",
        "https://192.168.1.1/x",
        "https://172.16.0.1/x",
        "https://100.64.0.1/x",
        "https://0.0.0.0/x",
        "https://224.0.0.1/x",
        "https://240.0.0.1/x",
        "https://[::1]/x",
        "https://[::]/x",
        "https://[fe80::1]/x",
        "https://[fc00::1]/x",
        "https://[ff02::1]/x",
        "https://[fec0::1]/x",
        "https://[::ffff:10.0.0.1]/x",
        "https://[::ffff:127.0.0.1]/x",
        "https://localhost/x",
        "https://LOCALHOST/x",
        "https://localhost./x",
        "https://api.localhost/x",
    ],
)
def test_private_literal_hosts_are_rejected_without_a_fetch(client_id: str) -> None:
    world = _world(_response(_document(client_id=client_id)))

    assert world.source.resolve(client_id) is None
    assert world.fetcher.urls == []


def test_a_public_literal_ip_is_allowed() -> None:
    client_id = f"https://{PUBLIC_IP}/x"
    world = _world(_response(_document(client_id=client_id)))

    assert world.source.resolve(client_id) is not None
    assert world.resolver.hosts == []


@pytest.mark.parametrize(
    "addresses",
    [
        ["10.0.0.5"],
        ["127.0.0.1"],
        ["169.254.169.254"],
        ["::1"],
        ["fe80::1%eth0"],
        ["::ffff:192.168.0.1"],
        ["100.64.0.9"],
        [PUBLIC_IP, "10.0.0.5"],
        ["10.0.0.5", PUBLIC_IP],
        [PUBLIC_IP, "::1"],
        ["2606:2800:220:1:248:1893:25c8:1946", "fd00::1"],
        ["not-an-ip"],
        [],
    ],
)
def test_hosts_resolving_to_any_non_public_address_are_rejected_without_a_fetch(addresses: list[str]) -> None:
    resolver = _Resolver(addresses={"evil.example": addresses})
    client_id = "https://evil.example/x"
    world = _world(_response(_document(client_id=client_id)), resolver=resolver)

    assert world.source.resolve(client_id) is None
    assert world.resolver.hosts == ["evil.example"]
    assert world.fetcher.urls == []


def test_all_public_addresses_including_ipv6_are_allowed() -> None:
    resolver = _Resolver(addresses={"agent.example": [PUBLIC_IP, "2606:2800:220:1:248:1893:25c8:1946"]})
    world = _world(_response(_document()), resolver=resolver)

    assert world.source.resolve(URL) is not None


def test_an_unresolvable_host_fails_without_a_fetch() -> None:
    def failing_resolver(host: str) -> Sequence[str]:
        raise OSError(f"cannot resolve {host}")

    cache = _Cache()
    fetcher = _Fetcher([_response(_document())])
    source = CimdClientSource(cache=cache, fetch=fetcher, resolve_host=failing_resolver)

    assert source.resolve(URL) is None
    assert fetcher.urls == []


@pytest.mark.parametrize("client_id", ["native-app", "dcr_abc", "cimd:abc", "", "http://agent.example/c.json"])
def test_ids_that_are_not_https_urls_are_not_ours(client_id: str) -> None:
    world = _world(_response(_document()))

    assert world.source.resolve(client_id) is None
    assert world.fetcher.urls == []
    assert world.resolver.hosts == []
    assert world.cache.fetch_slots == set()


def test_a_fresh_cached_client_skips_the_fetch_and_the_throttle() -> None:
    world = _world(_response(_document(), max_age=300))
    first = world.source.resolve(URL)
    world.cache.expire_throttle()
    world.clock.advance(299)

    assert world.source.resolve(URL) == first
    assert world.fetcher.urls == [URL]
    assert world.cache.fetch_slots == set()


def test_a_stale_client_is_refetched_and_replaced_when_the_throttle_is_free() -> None:
    world = _world(_response(_document(), max_age=300), _response(_document(client_name="Renamed")))
    world.source.resolve(URL)
    world.cache.expire_throttle()
    world.clock.advance(301)

    refreshed = world.source.resolve(URL)

    assert refreshed is not None
    assert refreshed.display_name == "Renamed"
    assert world.fetcher.urls == [URL, URL]
    world.clock.advance(10)
    assert world.source.resolve(URL) == refreshed
    assert world.fetcher.urls == [URL, URL]


def test_a_stale_client_is_served_while_another_request_holds_the_throttle() -> None:
    world = _world(_response(_document(), max_age=300))
    first = world.source.resolve(URL)
    world.clock.advance(301)

    assert world.source.resolve(URL) == first
    assert world.fetcher.urls == [URL]


def test_a_stale_client_whose_refetch_fails_resolves_to_none_and_is_not_overwritten() -> None:
    world = _world(_response(_document(), max_age=300), CimdFetchError("down"))
    first = world.source.resolve(URL)
    world.cache.expire_throttle()
    world.clock.advance(301)
    cache_key = f"openapi_oauth:cimd:{sha256_hex(URL)}"
    before = world.cache.data[cache_key]

    assert world.source.resolve(URL) is None
    assert world.cache.data[cache_key] == before
    assert first is not None


def test_a_stale_client_whose_refetch_is_invalid_resolves_to_none() -> None:
    world = _world(_response(_document(), max_age=300), _response(_document(redirect_uris=[])))
    world.source.resolve(URL)
    world.cache.expire_throttle()
    world.clock.advance(301)

    assert world.source.resolve(URL) is None


def test_the_redis_entry_outlives_its_soft_expiry_by_the_stale_window() -> None:
    world = _world(_response(_document(), max_age=300))

    world.source.resolve(URL)

    assert world.cache.ttls[f"openapi_oauth:cimd:{sha256_hex(URL)}"] == 300 + CIMD_STALE_SECONDS


def test_with_no_entry_and_the_throttle_held_by_another_request_the_client_is_unknown() -> None:
    world = _world(_response(_document()))
    world.cache.fetch_slots.add(f"openapi_oauth:cimd_fetch:{sha256_hex(URL)}")

    assert world.source.resolve(URL) is None
    assert world.fetcher.urls == []


@pytest.mark.parametrize(
    ("max_age", "expected"),
    [
        (None, CIMD_CACHE_MIN_SECONDS),
        (0, CIMD_CACHE_MIN_SECONDS),
        (5, CIMD_CACHE_MIN_SECONDS),
        (300, 300),
        (10**9, CIMD_CACHE_MAX_SECONDS),
    ],
)
def test_cache_lifetime_follows_max_age_clamped(max_age: int | None, expected: int) -> None:
    world = _world(_response(_document(), max_age=max_age))

    world.source.resolve(URL)

    cache_key = f"openapi_oauth:cimd:{sha256_hex(URL)}"
    assert world.cache.ttls[cache_key] == expected + CIMD_STALE_SECONDS


def test_defaults_are_the_documented_values() -> None:
    assert CIMD_CACHE_MIN_SECONDS == 60
    assert CIMD_CACHE_MAX_SECONDS == 86400
    assert CIMD_FETCH_INTERVAL_SECONDS == 10
    assert CIMD_MAX_BYTES == 5 * 1024
    assert CIMD_TIMEOUT_SECONDS == 5
    assert CIMD_TOTAL_DEADLINE_SECONDS == 10
    assert CIMD_STALE_SECONDS == 300


def test_an_invalid_document_is_never_cached_and_is_fetched_again_after_the_interval() -> None:
    world = _world(_response(_document(redirect_uris=[])), _response(_document()))

    assert world.source.resolve(URL) is None
    assert f"openapi_oauth:cimd:{sha256_hex(URL)}" not in world.cache.data

    world.cache.expire_throttle()
    client = world.source.resolve(URL)

    assert client is not None
    assert world.fetcher.urls == [URL, URL]


def test_a_fetch_error_is_never_cached() -> None:
    world = _world(CimdFetchError("down"), _response(_document()))

    assert world.source.resolve(URL) is None
    assert world.cache.data == {}

    world.cache.expire_throttle()

    assert world.source.resolve(URL) is not None


def test_a_second_request_inside_the_interval_does_not_fetch() -> None:
    world = _world(_response(_document(redirect_uris=[])), _response(_document()))

    assert world.source.resolve(URL) is None
    assert world.source.resolve(URL) is None
    assert world.fetcher.urls == [URL]
    throttle_key = f"openapi_oauth:cimd_fetch:{sha256_hex(URL)}"
    assert throttle_key in world.cache.fetch_slots
    assert world.cache.ttls[throttle_key] == CIMD_FETCH_INTERVAL_SECONDS


def test_the_throttle_is_per_url() -> None:
    other = "https://other.example/c.json"
    world = _world(_response(_document(redirect_uris=[])), _response(_document(client_id=other)))

    assert world.source.resolve(URL) is None
    assert world.source.resolve(other) is not None


def test_a_corrupt_cache_entry_is_a_miss() -> None:
    world = _world(_response(_document()))
    world.cache.data[f"openapi_oauth:cimd:{sha256_hex(URL)}"] = "{not json"

    assert world.source.resolve(URL) is not None
    assert world.fetcher.urls == [URL]


def _http_response(status: int = 200, *, body: bytes = b"{}", headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(status, content=body, headers=headers, request=httpx.Request("GET", URL))


@dataclass
class _Transport:
    response: httpx.Response | Exception
    calls: list[dict[str, object]] = field(default_factory=list)

    def make_request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append({"method": method, "url": url, **kwargs})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def _transport(monkeypatch: pytest.MonkeyPatch, response: httpx.Response | Exception) -> _Transport:
    transport = _Transport(response)
    monkeypatch.setattr(cimd_module.ssrf_proxy, "make_request", transport.make_request)
    return transport


def test_fetch_uses_the_ssrf_proxy_without_redirects_or_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = _transport(
        monkeypatch, _http_response(body=b'{"a": 1}', headers={"Cache-Control": "public, max-age=120"})
    )

    result = fetch_client_metadata(URL)

    assert result == CimdResponse(body=b'{"a": 1}', max_age=120)
    call = transport.calls[0]
    assert call["method"] == "GET"
    assert call["url"] == URL
    assert call["max_retries"] == 0
    assert call["follow_redirects"] is False
    assert call["timeout"] == CIMD_TIMEOUT_SECONDS
    assert call["stream_response"] is True
    assert call["ssl_verify"] is True
    assert call["headers"] == {"Accept-Encoding": "identity", "Accept": "application/json"}


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, None),
        ("no-store", None),
        ("max-age=abc", None),
        ("max-age=-5", None),
        ("MAX-AGE=45", 45),
        ("public, max-age=3600, must-revalidate", 3600),
        ('max-age="90"', 90),
    ],
)
def test_fetch_reads_max_age(monkeypatch: pytest.MonkeyPatch, header: str | None, expected: int | None) -> None:
    headers = {} if header is None else {"Cache-Control": header}
    _transport(monkeypatch, _http_response(headers=headers))

    assert fetch_client_metadata(URL).max_age == expected


@pytest.mark.parametrize("status", [201, 204, 301, 302, 307, 308, 400, 404, 500])
def test_fetch_fails_on_any_status_but_200(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    _transport(monkeypatch, _http_response(status, headers={"Location": "http://10.0.0.1/"}))

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


def test_fetch_fails_on_an_oversized_body(monkeypatch: pytest.MonkeyPatch) -> None:
    _transport(monkeypatch, _http_response(body=b"x" * (CIMD_MAX_BYTES + 1)))

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


def test_fetch_accepts_a_body_at_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    _transport(monkeypatch, _http_response(body=b"x" * CIMD_MAX_BYTES))

    assert len(fetch_client_metadata(URL).body) == CIMD_MAX_BYTES


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectTimeout("slow"),
        httpx.ConnectError("refused"),
        ResponseLimitError("too big"),
        cimd_module.ToolSSRFError("blocked"),
    ],
)
def test_fetch_wraps_transport_errors(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    _transport(monkeypatch, error)

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


def test_the_default_resolver_returns_ip_strings(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_getaddrinfo(host: str, port: object, **kwargs: object) -> list[tuple[int, int, int, str, tuple[str, int]]]:
        _ = host, port, kwargs
        return [(2, 1, 6, "", ("93.184.216.34", 0)), (10, 1, 6, "", ("2606:2800::1", 0, 0, 0))]  # type: ignore[list-item]

    monkeypatch.setattr(cimd_module.socket, "getaddrinfo", fake_getaddrinfo)

    assert cimd_module.resolve_host_addresses("agent.example") == ["93.184.216.34", "2606:2800::1"]


def test_a_gzip_response_is_a_fetch_error_not_an_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    gzipped = _http_response(body=gzip.compress(b"{}"), headers={"Content-Encoding": "gzip"})
    _transport(monkeypatch, gzipped)

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


def test_fetch_passes_the_total_deadline_to_the_buffer(monkeypatch: pytest.MonkeyPatch) -> None:
    _transport(monkeypatch, _http_response())
    seen: list[float | None] = []
    real = cimd_module.ssrf_proxy.buffer_response

    def spy(
        response: httpx.Response, *, max_response_bytes: int, deadline_seconds: float | None = None
    ) -> httpx.Response:
        seen.append(deadline_seconds)
        return real(response, max_response_bytes=max_response_bytes, deadline_seconds=deadline_seconds)

    monkeypatch.setattr(cimd_module.ssrf_proxy, "buffer_response", spy)

    fetch_client_metadata(URL)

    assert seen == [CIMD_TOTAL_DEADLINE_SECONDS]


def test_a_slow_drip_response_is_a_fetch_error(monkeypatch: pytest.MonkeyPatch) -> None:
    ticks = iter(float(second) for second in range(1000))
    monkeypatch.setattr(cimd_module.ssrf_proxy.time, "monotonic", lambda: next(ticks))

    def body() -> Iterator[bytes]:
        for _ in range(100):
            yield b" "

    streamed = httpx.Response(200, content=body(), request=httpx.Request("GET", URL))
    _transport(monkeypatch, streamed)

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


def test_an_invalid_url_error_from_the_http_client_is_a_fetch_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _transport(monkeypatch, httpx.InvalidURL("bad host"))

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


def test_a_deadline_error_resolves_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    _transport(monkeypatch, ResponseDeadlineError("too slow"))
    cache = _Cache()
    source = CimdClientSource(cache=cache, fetch=fetch_client_metadata, resolve_host=_Resolver())

    assert source.resolve(URL) is None
    assert cache.data == {}


@pytest.mark.parametrize(
    "client_id",
    ["https://2130706433/x", "https://0x7f.1/x", "https://127.0.0.1./x", "https://0177.0.0.1/x", "https://127.1/x"],
)
def test_numeric_spellings_of_loopback_are_rejected_through_the_real_resolver(client_id: str) -> None:
    fetcher = _Fetcher([_response(_document(client_id=client_id))])
    source = CimdClientSource(cache=_Cache(), fetch=fetcher, resolve_host=resolve_host_addresses)

    assert source.resolve(client_id) is None
    assert fetcher.urls == []
