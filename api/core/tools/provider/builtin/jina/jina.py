from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GoogleProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            pass
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SEARCH, ToolLabelEnum.PRODUCTIVITY
        ]