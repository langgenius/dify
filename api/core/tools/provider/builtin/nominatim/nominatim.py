from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.nominatim.tools.nominatim_search import NominatimSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class NominatimProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            result = NominatimSearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    'query': 'London',
                    'limit': 1,
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
