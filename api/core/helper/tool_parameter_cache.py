import json
from enum import StrEnum
from typing import Any

from pydantic import TypeAdapter, ValidationError

from extensions.ext_redis import redis_client

_parameters_adapter = TypeAdapter(dict[str, Any])


class ToolParameterCacheType(StrEnum):
    PARAMETER = "tool_parameter"


class ToolParameterCache:
    def __init__(
        self, tenant_id: str, provider: str, tool_name: str, cache_type: ToolParameterCacheType, identity_id: str
    ):
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
        cached_tool_parameter = redis_client.get(self.cache_key)
        if cached_tool_parameter:
            try:
                return _parameters_adapter.validate_json(cached_tool_parameter.decode("utf-8"))
            except (ValidationError, UnicodeDecodeError):
                return None
        return None

    def set(self, parameters: dict[str, Any]) -> None:
        """Cache model provider credentials."""
        redis_client.setex(self.cache_key, 86400, json.dumps(parameters))

    def delete(self) -> None:
        """
        Delete cached model provider credentials.

        :return:
        """
        redis_client.delete(self.cache_key)
