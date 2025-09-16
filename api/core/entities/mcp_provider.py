import json
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlparse

from pydantic import BaseModel

from configs import dify_config
from core.entities.provider_entities import BasicProviderConfig
from core.file import helpers as file_helpers
from core.helper import encrypter
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.mcp.types import OAuthClientInformation, OAuthClientMetadata, OAuthTokens
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.encryption import create_provider_encrypter

if TYPE_CHECKING:
    from models.tools import MCPToolProvider


class MCPProviderEntity(BaseModel):
    """MCP Provider domain entity for business logic operations"""

    # Basic identification
    id: str
    provider_id: str  # server_identifier
    name: str
    tenant_id: str
    user_id: str

    # Server connection info
    server_url: str  # encrypted URL
    headers: dict[str, str]  # encrypted headers
    timeout: float
    sse_read_timeout: float

    # Authentication related
    authed: bool
    credentials: dict[str, Any]  # encrypted credentials
    code_verifier: str | None = None  # for OAuth

    # Tools and display info
    tools: list[dict[str, Any]]  # parsed tools list
    icon: str | dict[str, str]  # parsed icon

    # Timestamps
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db_model(cls, db_provider: "MCPToolProvider") -> "MCPProviderEntity":
        """Create entity from database model with decryption"""

        return cls(
            id=db_provider.id,
            provider_id=db_provider.server_identifier,
            name=db_provider.name,
            tenant_id=db_provider.tenant_id,
            user_id=db_provider.user_id,
            server_url=db_provider.server_url,
            headers=db_provider.headers,
            timeout=db_provider.timeout,
            sse_read_timeout=db_provider.sse_read_timeout,
            authed=db_provider.authed,
            credentials=db_provider.credentials,
            tools=db_provider.tool_dict,
            icon=db_provider.icon or "",
            created_at=db_provider.created_at,
            updated_at=db_provider.updated_at,
        )

    @property
    def redirect_url(self) -> str:
        """OAuth redirect URL"""
        return dify_config.CONSOLE_API_URL + "/console/api/mcp/oauth/callback"

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

    @property
    def provider_icon(self) -> dict[str, str] | str:
        """Get provider icon, handling both dict and string formats"""
        if isinstance(self.icon, dict):
            return self.icon
        try:
            return json.loads(self.icon)
        except (json.JSONDecodeError, TypeError):
            # If not JSON, assume it's a file path
            return file_helpers.get_signed_file_url(self.icon)

    def to_api_response(self, user_name: str | None = None) -> dict[str, Any]:
        """Convert to API response format"""
        return {
            "id": self.id,
            "author": user_name or "Anonymous",
            "name": self.name,
            "icon": self.provider_icon,
            "type": ToolProviderType.MCP.value,
            "is_team_authorization": self.authed,
            "server_url": self.masked_server_url(),
            "server_identifier": self.provider_id,
            "timeout": self.timeout,
            "sse_read_timeout": self.sse_read_timeout,
            "masked_headers": self.masked_headers(),
            "updated_at": int(self.updated_at.timestamp()),
            "label": I18nObject(en_US=self.name, zh_Hans=self.name).to_dict(),
            "description": I18nObject(en_US="", zh_Hans="").to_dict(),
        }

    def retrieve_client_information(self) -> OAuthClientInformation | None:
        """OAuth client information if available"""
        client_info = self.decrypt_credentials().get("client_information", {})
        if not client_info:
            return None
        return OAuthClientInformation.model_validate(client_info)

    def retrieve_tokens(self) -> OAuthTokens | None:
        """OAuth tokens if available"""
        if not self.credentials:
            return None
        credentials = self.decrypt_credentials()
        return OAuthTokens(
            access_token=credentials.get("access_token", ""),
            token_type=credentials.get("token_type", "Bearer"),
            expires_in=int(credentials.get("expires_in", "3600") or 3600),
            refresh_token=credentials.get("refresh_token", ""),
        )

    def masked_server_url(self) -> str:
        """Masked server URL for display"""
        parsed = urlparse(self.decrypt_server_url())
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        if parsed.path and parsed.path != "/":
            return f"{base_url}/******"
        return base_url

    def masked_headers(self) -> dict[str, str]:
        """Masked headers for display"""
        masked: dict[str, str] = {}
        for key, value in self.decrypt_headers().items():
            if len(value) > 6:
                masked[key] = value[:2] + "*" * (len(value) - 4) + value[-2:]
            else:
                masked[key] = "*" * len(value)
        return masked

    def decrypt_server_url(self) -> str:
        """Decrypt server URL"""

        return encrypter.decrypt_token(self.tenant_id, self.server_url)

    def decrypt_headers(self) -> dict[str, Any]:
        """Decrypt headers"""

        try:
            if not self.headers:
                return {}

            # Create dynamic config for all headers as SECRET_INPUT
            config = [BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=key) for key in self.headers]

            encrypter_instance, _ = create_provider_encrypter(
                tenant_id=self.tenant_id,
                config=config,
                cache=NoOpProviderCredentialCache(),
            )

            result = encrypter_instance.decrypt(self.headers)
            return result
        except Exception:
            return {}

    def decrypt_credentials(
        self,
    ) -> dict[str, Any]:
        """Decrypt credentials"""
        try:
            if not self.credentials:
                return {}

            encrypter, _ = create_provider_encrypter(
                tenant_id=self.tenant_id,
                config=[
                    BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=key)
                    for key in self.credentials
                ],
                cache=NoOpProviderCredentialCache(),
            )

            return encrypter.decrypt(self.credentials)
        except Exception:
            return {}
