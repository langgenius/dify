from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class LiblibProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """
        Validate the credentials for Liblib
        """
        appkey = credentials.get("appkey")
        appsecret = credentials.get("appsecret")
        
        if not appkey:
            raise ToolProviderCredentialValidationError("appkey is required")
            
        if not appsecret:
            raise ToolProviderCredentialValidationError("appsecret is required")
            
        # TODO: Add validation logic to test the connection with appkey and appsecret
        # You can add actual API validation here
