from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class CodeToolProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        pass

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.PRODUCTIVITY
        ]