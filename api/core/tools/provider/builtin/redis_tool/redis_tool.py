from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.redis_tool.tools.get_string import GetStringTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class RedisProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            pass
            GetStringTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "key": "test"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
