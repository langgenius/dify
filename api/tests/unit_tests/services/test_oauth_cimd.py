import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import timedelta

import httpx
import pytest

import services.oauth_cimd as cimd_module
from libs.oauth_bearer import sha256_hex
from services.oauth_cimd import (
    CIMD_CACHE_MAX_SECONDS,
    CIMD_CACHE_MIN_SECONDS,
    CIMD_FETCH_INTERVAL_SECONDS,
    CIMD_MAX_BYTES,
    CIMD_STALE_SECONDS,
    FETCH_BUDGET_WINDOW_SECONDS,
    UNLIMITED_FETCHES,
    CimdClientSource,
    CimdFetchError,
    CimdResponse,
    cimd_storage_id,
    fetch_client_metadata,
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
    counters: dict[str, int] = field(default_factory=dict)

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

    def delete(self, *names: str) -> int:
        return sum(self.data.pop(name, None) is not None for name in names)

    def incr(self, name: str) -> int:
        self.counters[name] = self.counters.get(name, 0) + 1
        return self.counters[name]

    def expire(self, name: str, time: int) -> bool:
        self.ttls[name] = time
        return True

    def expire_throttle(self) -> None:
        self.fetch_slots.clear()


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
    fetcher: _Fetcher
    resolver: _Resolver
    fetch_limit_per_minute: int
    cache: _Cache = field(default_factory=_Cache)
    clock: _Clock = field(default_factory=_Clock)

    @property
    def source(self) -> CimdClientSource:
        return CimdClientSource(
            cache=self.cache,
            fetch=self.fetcher,
            resolve_host=self.resolver,
            fetch_limit_per_minute=self.fetch_limit_per_minute,
            now=self.clock,
        )


def _world(
    *responses: CimdResponse | Exception,
    resolver: _Resolver | None = None,
    fetch_limit_per_minute: int = UNLIMITED_FETCHES,
) -> _World:
    return _World(_Fetcher(list(responses)), resolver or _Resolver(), fetch_limit_per_minute)


def test_valid_document_resolves_to_a_public_client() -> None:
    grants = ["authorization_code", "urn:future:grant", "refresh_token", GrantType.DEVICE_CODE.value]
    world = _world(_response(_document(grant_types=grants, brand_new_field={"a": 1})))

    client = world.source.resolve(URL)

    assert client is not None
    assert client.client_id == URL
    assert client.storage_client_id == cimd_storage_id(URL)
    assert client.display_name == "Agent"
    assert client.redirect_uris == (REDIRECT,)
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN})
    assert world.fetcher.urls == [URL]
    assert len(cimd_storage_id("https://x.example/" + "a" * 1500)) <= 64


@pytest.mark.parametrize(
    "document",
    [
        _document(client_id="https://agent.example/other.json"),
        _document(redirect_uris=["http://agent.example/cb"]),
        _document(token_endpoint_auth_method="client_secret_basic"),
        _document(grant_types=["refresh_token"]),
    ],
)
def test_invalid_documents_are_rejected(document: object) -> None:
    world = _world(_response(document))

    assert world.source.resolve(URL) is None


@pytest.mark.parametrize(
    "client_id",
    [
        "http://agent.example/c.json",
        "https://user:pw@agent.example/c.json",
        "https://10.0.0.1/x",
        "https://127.0.0.1/x",
        "https://localhost/x",
        "https://private.example/x",
        "https://mixed.example/x",
        "dcr_abc",
    ],
)
def test_bad_or_non_public_client_ids_are_rejected_without_a_fetch(client_id: str) -> None:
    resolver = _Resolver(addresses={"private.example": ["10.0.0.5"], "mixed.example": [PUBLIC_IP, "::1"]})
    world = _world(_response(_document(client_id=client_id)), resolver=resolver)

    assert world.source.resolve(client_id) is None
    assert world.fetcher.urls == []


def test_a_fresh_client_is_served_from_cache_and_a_stale_one_is_refetched() -> None:
    world = _world(_response(_document(), max_age=300), _response(_document(client_name="Renamed")))
    first = world.source.resolve(URL)
    world.cache.expire_throttle()
    world.clock.advance(299)

    assert world.source.resolve(URL) == first
    assert world.cache.fetch_slots == set()

    world.clock.advance(2)
    refreshed = world.source.resolve(URL)

    assert refreshed is not None
    assert refreshed.display_name == "Renamed"
    assert world.fetcher.urls == [URL, URL]


def test_a_stale_client_is_served_while_the_throttle_is_held_the_refetch_fails_or_the_budget_is_spent() -> None:
    world = _world(_response(_document(), max_age=300), CimdFetchError("down"), fetch_limit_per_minute=1)
    first = world.source.resolve(URL)
    world.clock.advance(301)
    cache_key = f"openapi_oauth:cimd:{sha256_hex(URL)}"
    before = world.cache.data[cache_key]

    assert first is not None
    assert world.source.resolve(URL) == first
    assert world.fetcher.urls == [URL]

    world.cache.expire_throttle()

    assert world.source.resolve(URL) == first
    assert world.cache.data[cache_key] == before
    assert world.fetcher.urls == [URL, URL]

    world.cache.expire_throttle()

    assert world.source.resolve(URL) == first
    assert world.fetcher.urls == [URL, URL]


@pytest.mark.parametrize(
    "refetch", [_response(_document(redirect_uris=[])), cimd_module.CimdRejectedError()], ids=["invalid", "gone"]
)
def test_a_stale_client_whose_refetch_is_rejected_is_dropped_from_the_cache(
    refetch: CimdResponse | Exception,
) -> None:
    world = _world(_response(_document(), max_age=300), refetch)
    world.source.resolve(URL)
    world.cache.expire_throttle()
    world.clock.advance(301)

    assert world.source.resolve(URL) is None
    assert world.cache.data == {}


def test_a_stale_client_whose_host_became_private_is_dropped_from_the_cache() -> None:
    resolver = _Resolver()
    world = _world(_response(_document(), max_age=300), resolver=resolver)
    world.source.resolve(URL)
    resolver.addresses["agent.example"] = ["10.0.0.5"]
    world.cache.expire_throttle()
    world.clock.advance(301)

    assert world.source.resolve(URL) is None
    assert world.cache.data == {}
    assert world.fetcher.urls == [URL]


@pytest.mark.parametrize(
    ("max_age", "expected"),
    [(None, CIMD_CACHE_MIN_SECONDS), (300, 300), (10**9, CIMD_CACHE_MAX_SECONDS)],
)
def test_cache_lifetime_follows_max_age_clamped_plus_the_stale_window(max_age: int | None, expected: int) -> None:
    world = _world(_response(_document(), max_age=max_age))

    world.source.resolve(URL)

    assert world.cache.ttls[f"openapi_oauth:cimd:{sha256_hex(URL)}"] == expected + CIMD_STALE_SECONDS


@pytest.mark.parametrize("failure", [_response(_document(redirect_uris=[])), CimdFetchError("down")])
def test_a_failed_fetch_is_never_cached_and_is_retried_only_after_the_interval(
    failure: CimdResponse | Exception,
) -> None:
    world = _world(failure, _response(_document()))

    assert world.source.resolve(URL) is None
    assert world.source.resolve(URL) is None
    assert world.cache.data == {}
    assert world.fetcher.urls == [URL]
    assert world.cache.ttls[f"openapi_oauth:cimd_fetch:{sha256_hex(URL)}"] == CIMD_FETCH_INTERVAL_SECONDS

    world.cache.expire_throttle()

    assert world.source.resolve(URL) is not None


OTHER_URLS = [f"https://agent{i}.example/c.json" for i in range(3)]


def _documents_for(urls: list[str]) -> list[CimdResponse | Exception]:
    return [_response(_document(client_id=url)) for url in urls]


def test_the_fetch_budget_stops_fetches_past_the_limit_until_the_window_resets() -> None:
    world = _world(*_documents_for(OTHER_URLS[:2]), fetch_limit_per_minute=1)
    assert world.source.resolve(OTHER_URLS[0]) is not None
    assert world.source.resolve(OTHER_URLS[1]) is None
    assert world.resolver.hosts == ["agent0.example"]

    world.cache.expire_throttle()
    world.clock.advance(FETCH_BUDGET_WINDOW_SECONDS)

    assert world.source.resolve(OTHER_URLS[1]) is not None
    assert world.fetcher.urls == OTHER_URLS[:2]


def test_no_fetch_budget_means_unlimited_fetches() -> None:
    world = _world(*_documents_for(OTHER_URLS), fetch_limit_per_minute=UNLIMITED_FETCHES)

    assert all(world.source.resolve(url) is not None for url in OTHER_URLS)
    assert world.cache.counters == {}


def _http_response(status: int = 200, *, body: bytes = b"{}", headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(status, content=body, headers=headers, request=httpx.Request("GET", URL))


def _transport(monkeypatch: pytest.MonkeyPatch, outcome: httpx.Response | Exception) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    def make_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls.append({"method": method, "url": url, **kwargs})
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(cimd_module.ssrf_proxy, "make_request", make_request)
    return calls


def test_fetch_uses_the_ssrf_proxy_without_redirects_or_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _transport(monkeypatch, _http_response(body=b'{"a": 1}', headers={"Cache-Control": "public, max-age=120"}))

    result = fetch_client_metadata(URL)

    assert result == CimdResponse(body=b'{"a": 1}', max_age=120)
    [call] = calls
    assert call["max_retries"] == 0
    assert call["follow_redirects"] is False
    assert call["ssl_verify"] is True


@pytest.mark.parametrize(
    ("status", "error"),
    [(302, cimd_module.CimdRejectedError), (503, CimdFetchError)],
)
def test_fetch_rejects_non_200_and_treats_5xx_as_a_transport_failure(
    monkeypatch: pytest.MonkeyPatch, status: int, error: type[Exception]
) -> None:
    _transport(monkeypatch, _http_response(status, headers={"Location": "http://10.0.0.1/"}))

    with pytest.raises(error):
        fetch_client_metadata(URL)


@pytest.mark.parametrize(
    "outcome",
    [
        _http_response(body=b"x" * (CIMD_MAX_BYTES + 1)),
        httpx.ConnectTimeout("slow"),
        cimd_module.ToolSSRFError("blocked"),
    ],
    ids=["oversized", "timeout", "ssrf"],
)
def test_fetch_wraps_transport_failures(monkeypatch: pytest.MonkeyPatch, outcome: httpx.Response | Exception) -> None:
    _transport(monkeypatch, outcome)

    with pytest.raises(CimdFetchError):
        fetch_client_metadata(URL)


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
