from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.azure_bing_search_v7.tools.azure_bing_search_v7 import AzureBingSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AzureBingSearchProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            AzureBingSearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "test",
                    "count": 1,
                    "freshness": "Unspecified",
                    "market": "ja-JP"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
    