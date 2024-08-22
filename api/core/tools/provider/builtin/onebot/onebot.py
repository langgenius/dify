from typing import Any
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.onebot.tools.send_private_msg import SendPrivateMsg


class OneBotProvider(BuiltinToolProviderController):

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:

        if not credentials.get("ob11_http_url"):
            raise ToolProviderCredentialValidationError('OneBot HTTP URL is required.')
