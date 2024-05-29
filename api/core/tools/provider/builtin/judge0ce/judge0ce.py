from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.judge0ce.tools.executeCode import ExecuteCodeTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class Judge0CEProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            ExecuteCodeTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "source_code": "print('hello world')",
                    "language_id": 71,
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.OTHER, ToolLabelEnum.UTILITIES
        ]