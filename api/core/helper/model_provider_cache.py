import json
from enum import StrEnum
from typing import Any

from pydantic import TypeAdapter, ValidationError

from extensions.ext_redis import redis_client

_credentials_adapter = TypeAdapter(dict[str, Any])


class ProviderCredentialsCacheType(StrEnum):
    PROVIDER = "provider"
    MODEL = "provider_model"
    LOAD_BALANCING_MODEL = "load_balancing_provider_model"


class ProviderCredentialsCache:
    def __init__(self, tenant_id: str, identity_id: str, cache_type: ProviderCredentialsCacheType):
        self.cache_key = f"{cache_type}_credentials:v2:tenant_id:{tenant_id}:id:{identity_id}"

    def get(self) -> dict[str, Any] | None:
        """Read model provider credentials from the initialized Redis client.

        Return a JSON object with arbitrary values, or None for a missing,
        malformed, non-UTF-8, or non-object entry. Never mutate cached data;
        Redis failures propagate so callers can distinguish an outage from a miss.
        """
        cached_provider_credentials = redis_client.get(self.cache_key)
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
        redis_client.setex(self.cache_key, 86400, json.dumps(credentials))

    def delete(self) -> None:
        """
        Delete cached model provider credentials.

        :return:
        """
        redis_client.delete(self.cache_key)
