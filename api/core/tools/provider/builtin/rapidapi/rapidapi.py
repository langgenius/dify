from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.rapidapi.tools.google_news import GooglenewsTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class RapidapiProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            GooglenewsTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "language_region": "en-US",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
