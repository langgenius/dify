from typing import Any, Dict, List

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.webscraper.tools.webscraper import WebscraperTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class WebscraperProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            WebscraperTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    'url': 'https://www.google.com',
                    'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))