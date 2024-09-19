from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers.qrcode.tools.qrcode_generator import QRCodeGeneratorTool
from core.tools.errors import ToolProviderCredentialValidationError


class QRCodeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            QRCodeGeneratorTool().invoke(user_id="", tool_parameters={"content": "Dify 123 😊"})
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
