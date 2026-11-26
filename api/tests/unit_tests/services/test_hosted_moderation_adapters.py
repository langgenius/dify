import json
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from typing import override

import httpx
import pytest

from core.helper import ssrf_proxy as ssrf_module
from extensions.ext_redis import RedisClientWrapper
from machinery.context import AppRequestContext
from services.hosted_moderation_adapters import OpenAIHostedModerationClient, RedisHostedModerationVerdictCache
from services.hosted_moderation_service import BatchedHostedModerationService
from services.moderation_service import ModerationRule


@pytest.fixture
def openai_transport(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[list[httpx.Request], list[httpx.Response]]]:
    requests: list[httpx.Request] = []
    responses: list[httpx.Response] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return responses.pop(0)

    with httpx.Client(transport=httpx.MockTransport(handle), follow_redirects=True) as transport:

        def get_client(verify: bool) -> httpx.Client:
            assert verify
            return transport

        monkeypatch.setattr(ssrf_module, "_get_ssrf_client", get_client)
        yield requests, responses


def _client(*, api_key: str = "platform-key", base_url: str | None = None) -> OpenAIHostedModerationClient:
    return OpenAIHostedModerationClient(
        http_client=ssrf_module.ssrf_proxy,
        api_key=api_key,
        base_url=base_url,
        organization="platform-org",
    )


@pytest.mark.parametrize("base_url", ["https://moderation.example/", "https://moderation.example/v1/"])
def test_openai_sends_one_array_request_with_ordered_verdicts(
    openai_transport: tuple[list[httpx.Request], list[httpx.Response]], base_url: str
) -> None:
    requests, responses = openai_transport
    responses.append(httpx.Response(200, json={"results": [{"flagged": False}, {"flagged": True}]}))
    assert _client(base_url=base_url).moderate(["first", "second"]) == (False, True)
    (request,) = requests
    assert request.method == "POST"
    assert str(request.url) == "https://moderation.example/v1/moderations"
    assert request.headers["Authorization"] == "Bearer platform-key"
    assert request.headers["OpenAI-Organization"] == "platform-org"
    assert request.headers["Accept-Encoding"] == "identity"
    assert json.loads(request.content) == {"model": "omni-moderation-latest", "input": ["first", "second"]}


@pytest.mark.parametrize(
    ("results", "error"),
    [
        ([{"flagged": False}], "wrong number"),
        ([{"flagged": False}, {"flagged": "false"}], "malformed response"),
        ([{"flagged": False}, {"original_text": "private"}], "malformed response"),
    ],
)
def test_openai_refuses_incomplete_or_coerced_verdicts(
    openai_transport: tuple[list[httpx.Request], list[httpx.Response]],
    results: list[dict[str, object]],
    error: str,
) -> None:
    _, responses = openai_transport
    responses.append(httpx.Response(200, json={"results": results}))
    with pytest.raises(ValueError, match=error) as caught:
        _client().moderate(["first", "second"])
    assert "private" not in str(caught.value)


def test_openai_never_follows_redirects_with_the_platform_key(
    openai_transport: tuple[list[httpx.Request], list[httpx.Response]],
) -> None:
    requests, responses = openai_transport
    responses.append(httpx.Response(307, headers={"Location": "https://redirect.example/moderations"}))
    with pytest.raises(ValueError, match="HTTP 307"):
        _client().moderate(["text"])
    assert [request.url.host for request in requests] == ["api.openai.com"]


@pytest.mark.parametrize("base_url", ["http://example.com/v1", "https://user:secret@example.com/v1"])
def test_openai_refuses_insecure_base_urls_before_sending_credentials(
    openai_transport: tuple[list[httpx.Request], list[httpx.Response]], base_url: str
) -> None:
    requests, _ = openai_transport
    with pytest.raises(ValueError, match="HTTPS base URL"):
        _client(base_url=base_url).moderate(["text"])
    assert not requests


class _Pipeline:
    def __init__(self, entries: dict[str, tuple[bytes, int]]) -> None:
        self._entries = entries
        self._commands: list[Callable[[], object]] = []

    def _read(self, key: str) -> bytes | None:
        entry = self._entries.get(key)
        return entry[0] if entry else None

    def get(self, key: str) -> None:
        self._commands.append(lambda: self._read(key))

    def set(self, key: str, value: bytes, *, ex: int) -> None:
        self._commands.append(lambda: self._entries.__setitem__(key, (value, ex)))

    def execute(self) -> list[object]:
        return [command() for command in self._commands]


class _Redis(RedisClientWrapper):
    """Capture physical keys and expiry at the Redis command boundary."""

    def __init__(self) -> None:
        super().__init__()
        self.entries: dict[str, tuple[bytes, int]] = {}

    @override
    @contextmanager
    def pipeline(self, transaction: bool = True, shard_hint: str | None = None) -> Generator[_Pipeline]:
        assert not transaction
        assert shard_hint is None
        yield _Pipeline(self.entries)


def test_redis_stores_only_scoped_digests_and_booleans_with_ttl(config_overrides: Callable[..., None]) -> None:
    config_overrides(REDIS_KEY_PREFIX="deployment-1")
    redis = _Redis()
    cache = RedisHostedModerationVerdictCache(redis, ttl=600, hash_key=_client().cache_key)
    verdicts = {"private allow": False, "private flag": True}
    cache.store("tenant-1", verdicts)
    assert cache.lookup("tenant-1", tuple(verdicts)) == verdicts
    assert cache.lookup("tenant-2", tuple(verdicts)) == {}
    assert sorted(redis.entries.values()) == [(b"0", 600), (b"1", 600)]
    assert all(key.startswith("deployment-1:hosted_moderation:v1:") for key in redis.entries)
    assert not any("private" in key or "platform-key" in key for key in redis.entries)

    for changed in [_client(api_key="new-key"), _client(base_url="https://new.example/v1")]:
        rotated = RedisHostedModerationVerdictCache(redis, ttl=600, hash_key=changed.cache_key)
        assert rotated.lookup("tenant-1", tuple(verdicts)) == {}

    key = next(key for key, (value, _) in redis.entries.items() if value == b"1")
    redis.entries[key] = (b"unexpected", 600)
    assert cache.lookup("tenant-1", tuple(verdicts)) == {"private allow": False}


def test_a_rebuilt_service_reuses_redis_verdicts_and_only_sends_new_segments(
    openai_transport: tuple[list[httpx.Request], list[httpx.Response]],
) -> None:
    requests, responses = openai_transport
    redis = _Redis()
    context = AppRequestContext(tenant_id="tenant-1", app_id="app-1")
    rule = ModerationRule(type="openai_moderation", config={"inputs_config": {"enabled": True}})

    def service() -> BatchedHostedModerationService:
        client = _client()
        return BatchedHostedModerationService(
            client=client, cache=RedisHostedModerationVerdictCache(redis, ttl=600, hash_key=client.cache_key)
        )

    responses.extend(
        [
            httpx.Response(200, json={"results": [{"flagged": False}, {"flagged": False}]}),
            httpx.Response(200, json={"results": [{"flagged": False}]}),
        ]
    )
    service().check_segments(context, rule=rule, segments=["system", "prior"], phase="input")
    service().check_segments(context, rule=rule, segments=["system", "prior", "new"], phase="input")
    assert [json.loads(request.content)["input"] for request in requests] == [["system", "prior"], ["new"]]
    assert len(redis.entries) == 3


def test_redis_failure_is_a_miss_and_cache_writes_are_best_effort() -> None:
    cache = RedisHostedModerationVerdictCache(RedisClientWrapper(), ttl=600, hash_key=_client().cache_key)
    assert cache.lookup("tenant-1", ["one"]) == {}
    cache.store("tenant-1", {"one": False})
    assert cache.lookup("tenant-1", ["one"]) == {}
