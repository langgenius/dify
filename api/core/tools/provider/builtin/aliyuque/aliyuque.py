from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.aliyuque.tools.base import AliYuqueTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AliYuqueProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        token = credentials.get("token")
        if not token:
            raise ToolProviderCredentialValidationError("token is required")

        try:
            resp = AliYuqueTool.auth(token)
            if resp and resp.get("data", {}).get("id"):
                return

            raise ToolProviderCredentialValidationError(resp)
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
