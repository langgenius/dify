from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.redis_tool.tools.decorator import redis_client_decorator
from core.tools.tool.builtin_tool import BuiltinTool


class GetStringTool(BuiltinTool):

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """

        key = tool_parameters.get('key', '')
        if not key:
            return self.create_text_message('Invalid parameter key')

        value = self.run(key=key,
                         host=self.runtime.credentials.get('host'),
                         port=self.runtime.credentials.get('port'),
                         db=self.runtime.credentials.get('database'),
                         password=self.runtime.credentials.get('password'))
        return self.create_text_message(f'{value}')

    @staticmethod
    @redis_client_decorator
    def run(redis_client, key) -> str:
        return redis_client.get(key)

    # Extract data
    def _extract(self) -> str:
        try:
            pass
        except Exception as e:
            return str(e)
