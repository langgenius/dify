from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.searchapi.tools.google import GoogleTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SearchAPIProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            GoogleTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={"query": "SearchApi dify", "result_type": "link"},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
