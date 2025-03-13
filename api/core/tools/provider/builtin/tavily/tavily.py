from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.tavily.tools.tavily_search import TavilySearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TavilyProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            TavilySearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "query": "Sachin Tendulkar",
                    "search_depth": "basic",
                    "include_answer": True,
                    "include_images": False,
                    "include_raw_content": False,
                    "max_results": 5,
                    "include_domains": "",
                    "exclude_domains": "",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
