from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.tianditu.tools.poisearch import PoiSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TiandituProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            PoiSearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "content": "北京",
                    "specify": "156110000",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
