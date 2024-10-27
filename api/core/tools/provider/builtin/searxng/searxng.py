from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.searxng.tools.searxng_search import SearXNGSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SearXNGProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            SearXNGSearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "SearXNG",
                    "limit": 1,
                    "search_type": "general"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
