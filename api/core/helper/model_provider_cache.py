import json
from enum import StrEnum
from typing import Any

from pydantic import JsonValue, TypeAdapter, ValidationError

from extensions.ext_redis import RedisClientWrapper, redis_client

# Plugins define their own keys; the cache owns only the JSON object shape.
type CachedModelCredentials = dict[str, JsonValue]
_credentials_adapter = TypeAdapter(CachedModelCredentials)


class ProviderCredentialsCacheType(StrEnum):
    PROVIDER = "provider"
    MODEL = "provider_model"
    LOAD_BALANCING_MODEL = "load_balancing_provider_model"


class ProviderCredentialsCache:
    def __init__(
        self,
        tenant_id: str,
        identity_id: str,
        cache_type: ProviderCredentialsCacheType,
        *,
        redis: RedisClientWrapper | None = None,
    ) -> None:
        """Use the supplied Redis wrapper, or the application wrapper if omitted."""
        self._redis = redis_client if redis is None else redis
        self.cache_key = f"{cache_type}_credentials:v2:tenant_id:{tenant_id}:id:{identity_id}"

    def get(self) -> dict[str, Any] | None:
        """Read model provider credentials from the initialized Redis client.

        Return a JSON object with arbitrary values, or None for a missing,
        malformed, non-UTF-8, or non-object entry. Never mutate cached data;
        Redis failures propagate so callers can distinguish an outage from a miss.
        """
        cached_provider_credentials = self._redis.get(self.cache_key)
        if cached_provider_credentials:
            try:
                return _credentials_adapter.validate_json(cached_provider_credentials.decode("utf-8"))
            except (ValidationError, UnicodeDecodeError):
                return None
        return None

    def set(self, credentials: dict[str, Any]) -> None:
        """
        Cache model provider credentials.

        :param credentials: provider credentials
        :return:
        """
        self._redis.setex(self.cache_key, 86400, json.dumps(credentials))

    def delete(self) -> None:
        """
        Delete cached model provider credentials.

        :return:
        """
        self._redis.delete(self.cache_key)
