from typing import Optional

from configs import dify_config
from core.mcp.types import (
    OAuthClientInformation,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthTokens,
)
from services.tools.mcp_tools_mange_service import MCPToolManageService

LATEST_PROTOCOL_VERSION = "1.0"


class OAuthClientProvider:
    provider_id: str
    tenant_id: str

    def __init__(self, provider_id: str, tenant_id: str):
        self.provider_id = provider_id
        self.tenant_id = tenant_id

    @property
    def redirect_url(self) -> str:
        """The URL to redirect the user agent to after authorization."""
        return dify_config.CONSOLE_WEB_URL + "/tools"

    @property
    def client_metadata(self) -> OAuthClientMetadata:
        """Metadata about this OAuth client."""
        return OAuthClientMetadata(
            redirect_uris=[self.redirect_url],
            token_endpoint_auth_method="none",
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            client_name="Dify",
            client_uri="https://github.com/langgenius/dify",
        )

    def client_information(self) -> Optional[OAuthClientInformation]:
        """Loads information about this OAuth client."""
        mcp_provider = MCPToolManageService.get_mcp_provider_by_provider_id(self.provider_id, self.tenant_id)
        if not mcp_provider:
            return None
        client_information = mcp_provider.credentials.get("client_information", {})
        if not client_information:
            return None
        return OAuthClientInformation.model_validate(client_information)

    def save_client_information(self, client_information: OAuthClientInformationFull) -> None:
        """Saves client information after dynamic registration."""
        MCPToolManageService.update_mcp_provider_credentials(
            self.tenant_id, self.provider_id, {"client_information": client_information.model_dump()}
        )

    def tokens(self) -> Optional[OAuthTokens]:
        """Loads any existing OAuth tokens for the current session."""
        mcp_provider = MCPToolManageService.get_mcp_provider_by_provider_id(self.provider_id, self.tenant_id)
        if not mcp_provider:
            return None
        credentials = mcp_provider.credentials
        if not credentials:
            return None
        return OAuthTokens(
            access_token=credentials.get("access_token", ""),
            token_type=credentials.get("token_type", "Bearer"),
            expires_in=credentials.get("expires_in", 3600),
            refresh_token=credentials.get("refresh_token", ""),
        )

    def save_tokens(self, tokens: OAuthTokens) -> None:
        """Stores new OAuth tokens for the current session."""
        # update mcp provider credentials
        token_dict = tokens.model_dump()
        MCPToolManageService.update_mcp_provider_credentials(self.tenant_id, self.provider_id, token_dict, authed=True)

    def save_code_verifier(self, code_verifier: str) -> None:
        """Saves a PKCE code verifier for the current session."""
        # update mcp provider credentials
        MCPToolManageService.update_mcp_provider_credentials(
            self.tenant_id, self.provider_id, {"code_verifier": code_verifier}
        )

    def code_verifier(self) -> str:
        """Loads the PKCE code verifier for the current session."""
        # get code verifier from mcp provider credentials
        mcp_provider = MCPToolManageService.get_mcp_provider_by_provider_id(self.provider_id, self.tenant_id)
        if not mcp_provider:
            return ""
        return mcp_provider.credentials.get("code_verifier", "")
