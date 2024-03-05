from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.qrcode.tools.qrcode_generator import QRCodeGenratorTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class QRCodeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            QRCodeGenratorTool().invoke(user_id='', tool_parameters={})
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
