import json
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any
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

if TYPE_CHECKING:
    from models.tools import MCPToolProvider

# Constants
CLIENT_NAME = "Dify"
CLIENT_URI = "https://github.com/langgenius/dify"
DEFAULT_TOKEN_TYPE = "Bearer"
DEFAULT_EXPIRES_IN = 3600
MASK_CHAR = "*"
MIN_UNMASK_LENGTH = 6


class MCPSupportGrantType(StrEnum):
    """The supported grant types for MCP"""

    AUTHORIZATION_CODE = "authorization_code"
    CLIENT_CREDENTIALS = "client_credentials"
    REFRESH_TOKEN = "refresh_token"


class MCPAuthentication(BaseModel):
    client_id: str
    client_secret: str | None = None


class MCPConfiguration(BaseModel):
    timeout: float = 30
    sse_read_timeout: float = 300


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
        # Get grant type from credentials
        credentials = self.decrypt_credentials()

        # Try to get grant_type from different locations
        grant_type = credentials.get("grant_type", MCPSupportGrantType.AUTHORIZATION_CODE)

        # For nested structure, check if client_information has grant_types
        if "client_information" in credentials and isinstance(credentials["client_information"], dict):
            client_info = credentials["client_information"]
            # If grant_types is specified in client_information, use it to determine grant_type
            if "grant_types" in client_info and isinstance(client_info["grant_types"], list):
                if "client_credentials" in client_info["grant_types"]:
                    grant_type = MCPSupportGrantType.CLIENT_CREDENTIALS
                elif "authorization_code" in client_info["grant_types"]:
                    grant_type = MCPSupportGrantType.AUTHORIZATION_CODE

        # Configure based on grant type
        is_client_credentials = grant_type == MCPSupportGrantType.CLIENT_CREDENTIALS

        grant_types = ["refresh_token"]
        grant_types.append("client_credentials" if is_client_credentials else "authorization_code")

        response_types = [] if is_client_credentials else ["code"]
        redirect_uris = [] if is_client_credentials else [self.redirect_url]

        return OAuthClientMetadata(
            redirect_uris=redirect_uris,
            token_endpoint_auth_method="none",
            grant_types=grant_types,
            response_types=response_types,
            client_name=CLIENT_NAME,
            client_uri=CLIENT_URI,
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

    def to_api_response(self, user_name: str | None = None, include_sensitive: bool = True) -> dict[str, Any]:
        """Convert to API response format

        Args:
            user_name: User name to display
            include_sensitive: If False, skip expensive decryption operations (for list view optimization)
        """
        response = {
            "id": self.id,
            "author": user_name or "Anonymous",
            "name": self.name,
            "icon": self.provider_icon,
            "type": ToolProviderType.MCP.value,
            "is_team_authorization": self.authed,
            "server_url": self.masked_server_url(),
            "server_identifier": self.provider_id,
            "updated_at": int(self.updated_at.timestamp()),
            "label": I18nObject(en_US=self.name, zh_Hans=self.name).to_dict(),
            "description": I18nObject(en_US="", zh_Hans="").to_dict(),
        }

        # Add configuration
        response["configuration"] = {
            "timeout": str(self.timeout),
            "sse_read_timeout": str(self.sse_read_timeout),
        }

        # Skip expensive operations when sensitive data is not needed (e.g., list view)
        if not include_sensitive:
            response["masked_headers"] = {}
            response["is_dynamic_registration"] = True
        else:
            # Add masked headers
            response["masked_headers"] = self.masked_headers()

            # Add authentication info if available
            masked_creds = self.masked_credentials()
            if masked_creds:
                response["authentication"] = masked_creds
            response["is_dynamic_registration"] = self.credentials.get("client_information", {}).get(
                "is_dynamic_registration", True
            )

        return response

    def retrieve_client_information(self) -> OAuthClientInformation | None:
        """OAuth client information if available"""
        credentials = self.decrypt_credentials()
        if not credentials:
            return None

        # Check if we have nested client_information structure
        if "client_information" not in credentials:
            return None
        client_info_data = credentials["client_information"]
        if isinstance(client_info_data, dict):
            if "encrypted_client_secret" in client_info_data:
                client_info_data["client_secret"] = encrypter.decrypt_token(
                    self.tenant_id, client_info_data["encrypted_client_secret"]
                )
            return OAuthClientInformation.model_validate(client_info_data)
        return None

    def retrieve_tokens(self) -> OAuthTokens | None:
        """OAuth tokens if available"""
        if not self.credentials:
            return None
        credentials = self.decrypt_credentials()
        return OAuthTokens(
            access_token=credentials.get("access_token", ""),
            token_type=credentials.get("token_type", DEFAULT_TOKEN_TYPE),
            expires_in=int(credentials.get("expires_in", str(DEFAULT_EXPIRES_IN)) or DEFAULT_EXPIRES_IN),
            refresh_token=credentials.get("refresh_token", ""),
        )

    def masked_server_url(self) -> str:
        """Masked server URL for display"""
        parsed = urlparse(self.decrypt_server_url())
        if parsed.path and parsed.path != "/":
            masked = parsed._replace(path="/******")
            return masked.geturl()
        return parsed.geturl()

    def _mask_value(self, value: str) -> str:
        """Mask a sensitive value for display"""
        if len(value) > MIN_UNMASK_LENGTH:
            return value[:2] + MASK_CHAR * (len(value) - 4) + value[-2:]
        else:
            return MASK_CHAR * len(value)

    def masked_headers(self) -> dict[str, str]:
        """Masked headers for display"""
        return {key: self._mask_value(value) for key, value in self.decrypt_headers().items()}

    def masked_credentials(self) -> dict[str, str]:
        """Masked credentials for display"""
        credentials = self.decrypt_credentials()
        if not credentials:
            return {}

        masked = {}

        if "client_information" not in credentials or not isinstance(credentials["client_information"], dict):
            return {}
        client_info = credentials["client_information"]
        # Mask sensitive fields from nested structure
        if client_info.get("client_id"):
            masked["client_id"] = self._mask_value(client_info["client_id"])
        if client_info.get("encrypted_client_secret"):
            masked["client_secret"] = self._mask_value(
                encrypter.decrypt_token(self.tenant_id, client_info["encrypted_client_secret"])
            )
        if client_info.get("client_secret"):
            masked["client_secret"] = self._mask_value(client_info["client_secret"])
        return masked

    def decrypt_server_url(self) -> str:
        """Decrypt server URL"""
        return encrypter.decrypt_token(self.tenant_id, self.server_url)

    def _decrypt_dict(self, data: dict[str, Any]) -> dict[str, Any]:
        """Generic method to decrypt dictionary fields"""
        from core.tools.utils.encryption import create_provider_encrypter

        if not data:
            return {}

        # Only decrypt fields that are actually encrypted
        # For nested structures, client_information is not encrypted as a whole
        encrypted_fields = []
        for key, value in data.items():
            # Skip nested objects - they are not encrypted
            if isinstance(value, dict):
                continue
            # Only process string values that might be encrypted
            if isinstance(value, str) and value:
                encrypted_fields.append(key)

        if not encrypted_fields:
            return data

        # Create dynamic config only for encrypted fields
        config = [BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=key) for key in encrypted_fields]

        encrypter_instance, _ = create_provider_encrypter(
            tenant_id=self.tenant_id,
            config=config,
            cache=NoOpProviderCredentialCache(),
        )

        # Decrypt only the encrypted fields
        decrypted_data = encrypter_instance.decrypt({k: data[k] for k in encrypted_fields})

        # Merge decrypted data with original data (preserving non-encrypted fields)
        result = data.copy()
        result.update(decrypted_data)

        return result

    def decrypt_headers(self) -> dict[str, Any]:
        """Decrypt headers"""
        return self._decrypt_dict(self.headers)

    def decrypt_credentials(self) -> dict[str, Any]:
        """Decrypt credentials"""
        return self._decrypt_dict(self.credentials)

    def decrypt_authentication(self) -> dict[str, Any]:
        """Decrypt authentication"""
        # Option 1: if headers is provided, use it and don't need to get token
        headers = self.decrypt_headers()

        # Option 2: Add OAuth token if authed and no headers provided
        if not self.headers and self.authed:
            token = self.retrieve_tokens()
            if token:
                headers["Authorization"] = f"{token.token_type.capitalize()} {token.access_token}"
        return headers
