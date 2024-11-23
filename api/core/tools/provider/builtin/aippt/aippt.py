from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.aippt.tools.aippt import AIPPTGenerateTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AIPPTProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            AIPPTGenerateTool._get_api_token(credentials, user_id="__dify_system__")
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
