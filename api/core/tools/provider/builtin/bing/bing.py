from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.bing.tools.bing_web_search import BingSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class BingProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            BingSearchTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "test",
                    "result_type": "link",
                    "enable_webpages": True,
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
