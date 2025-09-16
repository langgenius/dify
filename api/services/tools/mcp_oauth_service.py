"""
MCP OAuth Service - handles OAuth-related database operations
"""

from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.types import OAuthClientInformationFull, OAuthTokens
from services.tools.mcp_tools_manage_service import MCPToolManageService


class MCPOAuthService:
    """Service for handling MCP OAuth operations"""

    def __init__(self, session: Session):
        self._session = session
        self._mcp_service = MCPToolManageService(session=session)

    def get_provider_entity(self, provider_id: str, tenant_id: str, by_server_id: bool = False) -> MCPProviderEntity:
        """Get provider entity by ID"""
        if by_server_id:
            db_provider = self._mcp_service.get_provider_by_server_identifier(provider_id, tenant_id)
        else:
            db_provider = self._mcp_service.get_provider_by_id(provider_id, tenant_id)
        return db_provider.to_entity()

    def save_client_information(
        self, provider_id: str, tenant_id: str, client_information: OAuthClientInformationFull
    ) -> None:
        """Save OAuth client information"""
        db_provider = self._mcp_service.get_provider_by_id(provider_id, tenant_id)
        self._mcp_service.update_provider_credentials(
            provider=db_provider,
            credentials={"client_information": client_information.model_dump()},
        )

    def save_tokens(self, provider_id: str, tenant_id: str, tokens: OAuthTokens, authed: bool = True) -> None:
        """Save OAuth tokens"""
        db_provider = self._mcp_service.get_provider_by_id(provider_id, tenant_id)
        token_dict = tokens.model_dump()
        self._mcp_service.update_provider_credentials(provider=db_provider, credentials=token_dict, authed=authed)

    def save_code_verifier(self, provider_id: str, tenant_id: str, code_verifier: str) -> None:
        """Save PKCE code verifier"""
        db_provider = self._mcp_service.get_provider_by_id(provider_id, tenant_id)
        self._mcp_service.update_provider_credentials(
            provider=db_provider, credentials={"code_verifier": code_verifier}
        )

    def clear_credentials(self, provider_id: str, tenant_id: str) -> None:
        """Clear provider credentials"""
        db_provider = self._mcp_service.get_provider_by_id(provider_id, tenant_id)
        self._mcp_service.clear_provider_credentials(provider=db_provider)
