import json
from enum import StrEnum
from typing import Any

from pydantic import JsonValue, TypeAdapter, ValidationError

from extensions.ext_redis import RedisClientWrapper, redis_client

# Plugins define their own keys; the cache owns only the JSON object shape.
type CachedToolParameters = dict[str, JsonValue]
_parameters_adapter = TypeAdapter(CachedToolParameters)


class ToolParameterCacheType(StrEnum):
    PARAMETER = "tool_parameter"


class ToolParameterCache:
    def __init__(
        self,
        tenant_id: str,
        provider: str,
        tool_name: str,
        cache_type: ToolParameterCacheType,
        identity_id: str,
        *,
        redis: RedisClientWrapper | None = None,
    ) -> None:
        """Use the supplied Redis wrapper, or the application wrapper if omitted."""
        self._redis = redis_client if redis is None else redis
        self.cache_key = (
            f"{cache_type}_secret:tenant_id:{tenant_id}:provider:{provider}:tool_name:{tool_name}"
            f":identity_id:{identity_id}"
        )

    def get(self) -> dict[str, Any] | None:
        """Read tool parameters from the initialized Redis client.

        Return a JSON object with arbitrary values, or None for a missing,
        malformed, non-UTF-8, or non-object entry. Never mutate cached data;
        Redis failures propagate so callers can distinguish an outage from a miss.
        """
        cached_tool_parameter = self._redis.get(self.cache_key)
        if cached_tool_parameter:
            try:
                return _parameters_adapter.validate_json(cached_tool_parameter.decode("utf-8"))
            except (ValidationError, UnicodeDecodeError):
                return None
        return None

    def set(self, parameters: dict[str, Any]) -> None:
        """Cache model provider credentials."""
        self._redis.setex(self.cache_key, 86400, json.dumps(parameters))

    def delete(self) -> None:
        """
        Delete cached model provider credentials.

        :return:
        """
        self._redis.delete(self.cache_key)
