"""Redis-backed access-token caching for the concrete DingTalk adapter."""

from __future__ import annotations

import hashlib
import logging
from typing import Protocol

from redis import RedisError

from core.human_input_v2.im_integration.adapters.dingtalk import (
    _new_oauth_client,
    _OAuthClient,
    _request_access_token,
)
from core.human_input_v2.im_provider import DingTalkIMIntegrationCredentials

logger = logging.getLogger(__name__)

_CACHE_KEY_PREFIX = "dify:human-input-v2:dingtalk:access-token:"
_EXPIRY_SAFETY_MARGIN_SECONDS = 60


class _RedisCacheClient(Protocol):
    def get(self, name: str) -> object: ...

    def ttl(self, name: str) -> object: ...

    def set(self, name: str, value: str, *, ex: int) -> object: ...


class RedisCacheAccessTokenProvider:
    """Provide DingTalk access tokens with a shared Redis optimization."""

    def __init__(self, credentials: DingTalkIMIntegrationCredentials, cache: _RedisCacheClient) -> None:
        if not isinstance(credentials, DingTalkIMIntegrationCredentials):
            raise TypeError("DingTalk token provider requires resolved DingTalk credentials")
        self._credentials = credentials
        self._cache = cache
        self._client: _OAuthClient = _new_oauth_client()
        self._cache_key = _cache_key(credentials.client_id)

    def get(self) -> str:
        cached_token = self._read_cached_token()
        if cached_token is not None:
            return cached_token

        fresh_token = _request_access_token(self._client, self._credentials)
        cache_ttl = fresh_token.expires_in - _EXPIRY_SAFETY_MARGIN_SECONDS
        if cache_ttl > 0:
            try:
                self._cache.set(self._cache_key, fresh_token.value, ex=cache_ttl)
            except RedisError:
                logger.warning("Failed to write DingTalk access-token cache; returning the fresh token.")
        return fresh_token.value

    def _read_cached_token(self) -> str | None:
        try:
            cached_value = self._cache.get(self._cache_key)
            cached_token = _decode_cached_token(cached_value)
            if cached_token is None:
                return None
            ttl = self._cache.ttl(self._cache_key)
        except UnicodeDecodeError:
            logger.warning("Ignored a malformed DingTalk access-token cache entry.")
            return None
        except RedisError:
            logger.warning("Failed to read DingTalk access-token cache; requesting a fresh token.")
            return None

        if isinstance(ttl, int) and not isinstance(ttl, bool) and ttl > 0:
            return cached_token
        return None


def _cache_key(client_id: str) -> str:
    digest = hashlib.sha256(client_id.encode()).hexdigest()
    return f"{_CACHE_KEY_PREFIX}{digest}"


def _decode_cached_token(value: object) -> str | None:
    if isinstance(value, bytes):
        token = value.decode("utf-8")
    elif isinstance(value, str):
        token = value
    else:
        return None
    return token if token.strip() else None


__all__ = ["RedisCacheAccessTokenProvider"]
