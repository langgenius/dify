from core.plugin.impl.base import BasePluginClient


class OAuthService(BasePluginClient):
    @classmethod
    def get_authorization_url(cls, tenant_id: str, user_id: str, provider_name: str) -> str:
        return "1234567890"
