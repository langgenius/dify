from core.tools.provider.builtin.feishu_base.tools.feishu_api import FeishuRequest
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FeishuBaseProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        app_id = credentials.get('app_id')
        app_secret = credentials.get('app_secret')
        if app_id is None or app_secret is None:
            raise Exception("app_id and app_secret is required")

        assert FeishuRequest(app_id, app_secret).tenant_access_token is not None