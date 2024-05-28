from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.vectorizer.tools.vectorizer import VectorizerTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class VectorizerProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            VectorizerTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "mode": "test",
                    "image_id": "__test_123"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.PRODUCTIVITY, ToolLabelEnum.IMAGE
        ]