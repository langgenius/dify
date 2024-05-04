from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.search1api.tools.search1api_search import Search1APISearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class Search1APIProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            Search1APISearchTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "Sachin Tendulkar",
                    "search_service": "google",
                    "images": False,
                    "max_results": 5,
                    "crawl_results": 0
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))