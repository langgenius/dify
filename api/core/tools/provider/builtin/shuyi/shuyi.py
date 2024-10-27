from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.shuyi.tools.shuyi_test import ShuyiTestTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class ShuyiProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            ShuyiTestTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "test",
                    "result_type": "link"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
    