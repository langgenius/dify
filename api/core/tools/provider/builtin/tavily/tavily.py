from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.tavily.tools.tavily_search import TavilySearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TavilyProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            TavilySearchTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "Sachin Tendulkar",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))