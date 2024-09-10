from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.utils.feishu_api_utils import FeishuRequest


class FeishuMessageProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        app_id = credentials.get('app_id')
        app_secret = credentials.get('app_secret')
        if not app_id or not app_secret:
            raise ToolProviderCredentialValidationError("app_id and app_secret is required")
        try:
            assert FeishuRequest(app_id, app_secret).tenant_access_token is not None
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))