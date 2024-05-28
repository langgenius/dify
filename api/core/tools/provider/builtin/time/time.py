from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.time.tools.current_time import CurrentTimeTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class WikiPediaProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            CurrentTimeTool().invoke(
                user_id='',
                tool_parameters={},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.UTILITIES
        ]