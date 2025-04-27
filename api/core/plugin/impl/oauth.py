from core.plugin.impl.base import BasePluginClient


class OAuthHandler(BasePluginClient):
    def get_authorization_url(self, tenant_id: str, user_id: str, provider_name: str) -> str:
        return "1234567890"
