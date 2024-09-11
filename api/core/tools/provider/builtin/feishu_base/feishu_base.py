from core.tools.provider.builtin.feishu_base.tools.get_tenant_access_token import GetTenantAccessTokenTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FeishuBaseProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        GetTenantAccessTokenTool()
        pass
