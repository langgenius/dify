from __future__ import annotations

import re
from types import SimpleNamespace
from typing import NoReturn

import pytest
from alibabacloud_dingtalk.oauth2_1_0.models import GetTokenRequest, GetTokenResponse, GetTokenResponseBody
from redis import RedisError

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import dingtalk as dingtalk_module
from core.human_input_v2.im_integration.adapters import dingtalk_redis
from core.human_input_v2.im_provider import DingTalkIMIntegrationCredentials


class _NoIOCache:
    def get(self, name: str) -> NoReturn:
        del name
        pytest.fail("unexpected Redis read during construction")

    def ttl(self, name: str) -> NoReturn:
        del name
        pytest.fail("unexpected Redis TTL read during construction")

    def set(self, name: str, value: str, *, ex: int) -> NoReturn:
        del name, value, ex
        pytest.fail("unexpected Redis write during construction")


class _NoIOOAuthClient:
    def get_token(self, corp_id: str, request: GetTokenRequest) -> NoReturn:
        del corp_id, request
        pytest.fail("unexpected DingTalk request during construction")


class _ProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__("provider detail must not escape")
        self.status_code = status_code


class _FakeOAuthClient:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, GetTokenRequest]] = []

    def get_token(self, corp_id: str, request: GetTokenRequest) -> object:
        self.calls.append((corp_id, request))
        if not self.responses:
            pytest.fail("unexpected DingTalk request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _FakeCache:
    def __init__(
        self,
        value: object = None,
        *,
        ttl: object = 3600,
        get_error: Exception | None = None,
        ttl_error: Exception | None = None,
        set_error: Exception | None = None,
    ) -> None:
        self.value = value
        self.ttl_value = ttl
        self.get_error = get_error
        self.ttl_error = ttl_error
        self.set_error = set_error
        self.get_calls: list[str] = []
        self.ttl_calls: list[str] = []
        self.set_calls: list[tuple[str, str, int]] = []

    def get(self, name: str) -> object:
        self.get_calls.append(name)
        if self.get_error is not None:
            raise self.get_error
        return self.value

    def ttl(self, name: str) -> object:
        self.ttl_calls.append(name)
        if self.ttl_error is not None:
            raise self.ttl_error
        return self.ttl_value

    def set(self, name: str, value: str, *, ex: int) -> object:
        self.set_calls.append((name, value, ex))
        if self.set_error is not None:
            raise self.set_error
        return True


def _credentials(
    *,
    corp_id: str = "sanitized-corp-id",
    client_id: str = "sanitized-client-id",
    client_secret: str = "sanitized-client-secret",
) -> DingTalkIMIntegrationCredentials:
    return DingTalkIMIntegrationCredentials(
        provider=IMProvider.DING_TALK,
        corp_id=corp_id,
        client_id=client_id,
        client_secret=client_secret,
    )


def _token_response(token: str = "sanitized-fresh-token", *, expires_in: int = 7200) -> GetTokenResponse:
    return GetTokenResponse(
        status_code=200,
        body=GetTokenResponseBody(access_token=token, expires_in=expires_in),
    )


def _provider(
    monkeypatch: pytest.MonkeyPatch,
    cache: _FakeCache,
    *responses: object,
    credentials: DingTalkIMIntegrationCredentials | None = None,
) -> tuple[dingtalk_redis.RedisCacheAccessTokenProvider, _FakeOAuthClient]:
    client = _FakeOAuthClient(*responses)
    monkeypatch.setattr(dingtalk_redis, "_new_oauth_client", lambda: client)
    return dingtalk_redis.RedisCacheAccessTokenProvider(credentials or _credentials(), cache), client


def test_constructor_performs_no_cache_or_provider_io(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dingtalk_redis, "_new_oauth_client", _NoIOOAuthClient)

    dingtalk_redis.RedisCacheAccessTokenProvider(_credentials(), _NoIOCache())


def test_constructor_rejects_unresolved_credentials_before_client_or_cache_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dingtalk_redis, "_new_oauth_client", lambda: pytest.fail("unexpected client construction"))
    provider_type_name = "RedisCacheAccessTokenProvider"
    provider_type = getattr(dingtalk_redis, provider_type_name)

    with pytest.raises(TypeError, match="resolved DingTalk credentials"):
        provider_type(object(), _NoIOCache())


def test_cache_miss_requests_once_and_writes_with_atomic_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = _FakeCache()
    provider, client = _provider(monkeypatch, cache, _token_response())

    assert provider.get() == "sanitized-fresh-token"

    assert len(client.calls) == 1
    corp_id, request = client.calls[0]
    assert corp_id == "sanitized-corp-id"
    assert request.client_id == "sanitized-client-id"
    assert request.client_secret == "sanitized-client-secret"
    assert request.grant_type == "client_credentials"
    assert len(cache.get_calls) == 1
    assert cache.ttl_calls == []
    assert cache.set_calls == [(cache.get_calls[0], "sanitized-fresh-token", 7140)]
    cache_key = cache.get_calls[0]
    assert re.fullmatch(r"dify:human-input-v2:dingtalk:access-token:[0-9a-f]{64}", cache_key)
    for sensitive_value in (*_credentials().model_dump().values(), "sanitized-fresh-token"):
        assert str(sensitive_value) not in cache_key


@pytest.mark.parametrize("cached_value", [b"sanitized-cached-token", "sanitized-cached-token"])
def test_cache_hit_accepts_text_or_utf8_bytes(monkeypatch: pytest.MonkeyPatch, cached_value: object) -> None:
    cache = _FakeCache(cached_value, ttl=1)
    provider, client = _provider(monkeypatch, cache)

    assert provider.get() == "sanitized-cached-token"
    assert len(cache.ttl_calls) == 1
    assert cache.ttl_calls == cache.get_calls
    assert cache.set_calls == []
    assert client.calls == []


@pytest.mark.parametrize("ttl", [0, -1, -2, True, None, "1", 1.0])
def test_non_strictly_positive_integer_ttl_is_a_cache_miss(
    monkeypatch: pytest.MonkeyPatch,
    ttl: object,
) -> None:
    cache = _FakeCache("sanitized-stale-token", ttl=ttl)
    provider, client = _provider(monkeypatch, cache, _token_response())

    assert provider.get() == "sanitized-fresh-token"
    assert len(client.calls) == 1
    assert len(cache.set_calls) == 1


@pytest.mark.parametrize(
    "cached_value",
    [
        None,
        b"",
        b"   ",
        "",
        "\t",
        b"\xff",
        1,
        True,
        [],
        {},
        object(),
        bytearray(b"sanitized-token"),
    ],
)
def test_invalid_cache_value_is_a_miss(monkeypatch: pytest.MonkeyPatch, cached_value: object) -> None:
    cache = _FakeCache(cached_value)
    provider, client = _provider(monkeypatch, cache, _token_response())

    assert provider.get() == "sanitized-fresh-token"
    assert len(client.calls) == 1
    assert cache.ttl_calls == []
    assert len(cache.set_calls) == 1


@pytest.mark.parametrize(("expires_in", "expected_ttl"), [(61, 1), (60, None), (1, None)])
def test_safety_margin_bounds_cache_lifetime(
    monkeypatch: pytest.MonkeyPatch,
    expires_in: int,
    expected_ttl: int | None,
) -> None:
    cache = _FakeCache()
    provider, _client = _provider(monkeypatch, cache, _token_response(expires_in=expires_in))

    assert provider.get() == "sanitized-fresh-token"
    if expected_ttl is None:
        assert cache.set_calls == []
    else:
        assert cache.set_calls[0][2] == expected_ttl


def test_cache_identity_uses_only_client_id(monkeypatch: pytest.MonkeyPatch) -> None:
    credential_sets = (
        _credentials(),
        _credentials(corp_id="sanitized-other-corp"),
        _credentials(client_secret="sanitized-other-secret"),
        _credentials(client_id="sanitized-other-client"),
    )
    cache_keys: list[str] = []

    for credentials in credential_sets:
        cache = _FakeCache()
        provider, _client = _provider(
            monkeypatch,
            cache,
            _token_response(),
            credentials=credentials,
        )

        assert provider.get() == "sanitized-fresh-token"
        cache_keys.append(cache.get_calls[0])

    assert cache_keys[0] == cache_keys[1] == cache_keys[2]
    assert cache_keys[0] != cache_keys[3]


@pytest.mark.parametrize("failure_operation", ["get", "ttl"])
def test_cache_read_failure_falls_back_with_safe_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failure_operation: str,
) -> None:
    error = RedisError("sanitized-client-secret sanitized-cached-token")
    cache = _FakeCache(
        "sanitized-cached-token",
        get_error=error if failure_operation == "get" else None,
        ttl_error=error if failure_operation == "ttl" else None,
    )
    provider, client = _provider(monkeypatch, cache, _token_response())

    assert provider.get() == "sanitized-fresh-token"
    assert len(client.calls) == 1
    assert len(cache.set_calls) == 1
    assert "access-token cache" in caplog.text
    assert "sanitized-client-secret" not in caplog.text
    assert "sanitized-cached-token" not in caplog.text


def test_cache_write_failure_returns_fresh_token_with_safe_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    cache = _FakeCache(set_error=RedisError("sanitized-client-secret sanitized-fresh-token"))
    provider, client = _provider(monkeypatch, cache, _token_response())

    assert provider.get() == "sanitized-fresh-token"
    assert len(client.calls) == 1
    assert len(cache.set_calls) == 1
    assert "access-token cache" in caplog.text
    assert "sanitized-client-secret" not in caplog.text
    assert "sanitized-fresh-token" not in caplog.text


@pytest.mark.parametrize("failure_operation", ["get", "ttl", "set"])
def test_non_redis_runtime_errors_are_not_silently_treated_as_cache_failures(
    monkeypatch: pytest.MonkeyPatch,
    failure_operation: str,
) -> None:
    error = RuntimeError("programming error outside the Redis failure contract")
    cache = _FakeCache(
        None if failure_operation == "set" else "sanitized-cached-token",
        get_error=error if failure_operation == "get" else None,
        ttl_error=error if failure_operation == "ttl" else None,
        set_error=error if failure_operation == "set" else None,
    )
    provider, client = _provider(monkeypatch, cache, _token_response())

    with pytest.raises(RuntimeError, match="programming error"):
        provider.get()

    expected_sdk_calls = 1 if failure_operation == "set" else 0
    assert len(client.calls) == expected_sdk_calls


@pytest.mark.parametrize(
    ("response", "expected_error"),
    [
        (_ProviderError(401), dingtalk_module._AuthenticationRejectedError),
        (_ProviderError(500), dingtalk_module._AccessTokenError),
        (SimpleNamespace(body=None), dingtalk_module._AccessTokenError),
        (_token_response(token=""), dingtalk_module._AccessTokenError),
        (_token_response(expires_in=0), dingtalk_module._AccessTokenError),
        (_token_response(expires_in=True), dingtalk_module._AccessTokenError),
    ],
)
def test_provider_failure_propagates_without_retry_or_cache_write(
    monkeypatch: pytest.MonkeyPatch,
    response: object,
    expected_error: type[Exception],
) -> None:
    cache = _FakeCache()
    provider, client = _provider(monkeypatch, cache, response)

    with pytest.raises(expected_error):
        provider.get()

    assert len(client.calls) == 1
    assert cache.set_calls == []
