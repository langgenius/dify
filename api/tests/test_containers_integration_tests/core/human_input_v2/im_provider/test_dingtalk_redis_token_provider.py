from __future__ import annotations

import os
from uuid import uuid4

import pytest
from alibabacloud_dingtalk.oauth2_1_0.models import GetTokenRequest, GetTokenResponse, GetTokenResponseBody
from redis import Redis

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import dingtalk_redis
from core.human_input_v2.im_provider import DingTalkIMIntegrationCredentials


class _FakeOAuthClient:
    def __init__(self, response: GetTokenResponse | None = None) -> None:
        self.response = response
        self.calls: list[tuple[str, GetTokenRequest]] = []

    def get_token(self, corp_id: str, request: GetTokenRequest) -> GetTokenResponse:
        self.calls.append((corp_id, request))
        if self.response is None:
            pytest.fail("cached provider unexpectedly requested a DingTalk token")
        return self.response


def _token_response(token: str, *, expires_in: int = 180) -> GetTokenResponse:
    return GetTokenResponse(
        status_code=200,
        body=GetTokenResponseBody(access_token=token, expires_in=expires_in),
    )


def test_real_redis_reuses_tokens_for_the_same_client_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis_url = os.getenv("REDIS_URL")
    if redis_url is None or not redis_url.strip():
        pytest.skip("REDIS_URL is unavailable")

    identity = uuid4().hex
    credentials = DingTalkIMIntegrationCredentials(
        provider=IMProvider.DING_TALK,
        corp_id=f"fake-corp-{identity}",
        client_id=f"fake-client-{identity}",
        client_secret=f"fake-secret-{identity}",
    )
    changed_credentials = credentials.model_copy(update={"client_secret": f"fake-changed-secret-{identity}"})
    short_lived_credentials = credentials.model_copy(update={"client_id": f"fake-short-client-{identity}"})
    first_client = _FakeOAuthClient(_token_response("fake-fresh-token-primary"))
    cached_client = _FakeOAuthClient()
    changed_client = _FakeOAuthClient()
    text_cached_client = _FakeOAuthClient()
    malformed_client = _FakeOAuthClient(_token_response("fake-recovered-token-malformed"))
    persistent_client = _FakeOAuthClient(_token_response("fake-recovered-token-persistent"))
    short_lived_client = _FakeOAuthClient(_token_response("fake-short-lived-token", expires_in=60))
    clients = iter(
        (
            first_client,
            cached_client,
            changed_client,
            text_cached_client,
            malformed_client,
            persistent_client,
            short_lived_client,
        )
    )
    monkeypatch.setattr(dingtalk_redis, "_new_oauth_client", lambda: next(clients))
    cache = Redis.from_url(redis_url, decode_responses=False)
    text_cache = Redis.from_url(redis_url, decode_responses=True)
    primary_key = dingtalk_redis._cache_key(credentials.client_id)
    changed_key = dingtalk_redis._cache_key(changed_credentials.client_id)
    short_lived_key = dingtalk_redis._cache_key(short_lived_credentials.client_id)

    try:
        first_provider = dingtalk_redis.RedisCacheAccessTokenProvider(credentials, cache)
        cached_provider = dingtalk_redis.RedisCacheAccessTokenProvider(credentials, cache)
        changed_provider = dingtalk_redis.RedisCacheAccessTokenProvider(changed_credentials, cache)

        assert first_provider.get() == "fake-fresh-token-primary"
        primary_ttl = cache.ttl(primary_key)
        assert 0 < primary_ttl <= 120
        assert cached_provider.get() == "fake-fresh-token-primary"
        assert cached_client.calls == []

        assert changed_provider.get() == "fake-fresh-token-primary"
        assert changed_client.calls == []
        assert changed_key == primary_key
        assert cache.get(primary_key) == b"fake-fresh-token-primary"

        text_cached_provider = dingtalk_redis.RedisCacheAccessTokenProvider(credentials, text_cache)
        assert text_cached_provider.get() == "fake-fresh-token-primary"
        assert text_cached_client.calls == []

        cache.set(changed_key, b"\xff", ex=120)
        malformed_provider = dingtalk_redis.RedisCacheAccessTokenProvider(changed_credentials, cache)
        assert malformed_provider.get() == "fake-recovered-token-malformed"
        assert len(malformed_client.calls) == 1

        cache.set(changed_key, "fake-persistent-token")
        persistent_provider = dingtalk_redis.RedisCacheAccessTokenProvider(changed_credentials, cache)
        assert persistent_provider.get() == "fake-recovered-token-persistent"
        assert len(persistent_client.calls) == 1

        short_lived_provider = dingtalk_redis.RedisCacheAccessTokenProvider(short_lived_credentials, cache)
        assert short_lived_provider.get() == "fake-short-lived-token"
        assert len(short_lived_client.calls) == 1
        assert cache.exists(short_lived_key) == 0
    finally:
        cache.delete(primary_key, short_lived_key)
        assert cache.exists(primary_key, short_lived_key) == 0
        text_cache.close()
        cache.close()
