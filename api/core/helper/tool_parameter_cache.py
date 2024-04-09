import json
from enum import Enum
from json import JSONDecodeError
from typing import Optional

from extensions.ext_redis import redis_client


class ToolParameterCacheType(Enum):
    PARAMETER = "tool_parameter"

class ToolParameterCache:
    def __init__(self, 
                 tenant_id: str, 
                 provider: str, 
                 tool_name: str, 
                 cache_type: ToolParameterCacheType
        ):
        self.cache_key = f"{cache_type.value}_secret:tenant_id:{tenant_id}:provider:{provider}:tool_name:{tool_name}"

    def get(self) -> Optional[dict]:
        """
        Get cached model provider credentials.

        :return:
        """
        cached_tool_parameter = redis_client.get(self.cache_key)
        if cached_tool_parameter:
            try:
                cached_tool_parameter = cached_tool_parameter.decode('utf-8')
                cached_tool_parameter = json.loads(cached_tool_parameter)
            except JSONDecodeError:
                return None

            return cached_tool_parameter
        else:
            return None

    def set(self, parameters: dict) -> None:
        """
        Cache model provider credentials.

        :param credentials: provider credentials
        :return:
        """
        redis_client.setex(self.cache_key, 86400, json.dumps(parameters))

    def delete(self) -> None:
        """
        Delete cached model provider credentials.

        :return:
        """
        redis_client.delete(self.cache_key)