from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers.time.tools.current_time import CurrentTimeTool
from core.tools.errors import ToolProviderCredentialValidationError


class WikiPediaProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            CurrentTimeTool().invoke(
                user_id="",
                tool_parameters={},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
