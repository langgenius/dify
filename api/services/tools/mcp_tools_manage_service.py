import hashlib
import json
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPProviderEntity
from core.helper import encrypter
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError, MCPError
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.utils.encryption import ProviderConfigEncrypter
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)

UNCHANGED_SERVER_URL_PLACEHOLDER = "[__HIDDEN__]"


class MCPToolManageService:
    """Service class for managing MCP tools and providers."""

    def __init__(self, session: Session):
        self._session = session

    # ========== Provider CRUD Operations ==========

    def get_provider(
        self, *, provider_id: Optional[str] = None, server_identifier: Optional[str] = None, tenant_id: str
    ) -> MCPToolProvider:
        """
        Get MCP provider by ID or server identifier.

        Args:
            provider_id: Provider ID (UUID)
            server_identifier: Server identifier
            tenant_id: Tenant ID

        Returns:
            MCPToolProvider instance

        Raises:
            ValueError: If provider not found
        """
        if server_identifier:
            stmt = select(MCPToolProvider).where(
                MCPToolProvider.tenant_id == tenant_id, MCPToolProvider.server_identifier == server_identifier
            )
        else:
            stmt = select(MCPToolProvider).where(
                MCPToolProvider.tenant_id == tenant_id, MCPToolProvider.id == provider_id
            )

        provider = self._session.scalar(stmt)
        if not provider:
            raise ValueError("MCP tool not found")
        return provider

    def get_provider_entity(self, provider_id: str, tenant_id: str, by_server_id: bool = False) -> MCPProviderEntity:
        """Get provider entity by ID or server identifier."""
        if by_server_id:
            db_provider = self.get_provider(server_identifier=provider_id, tenant_id=tenant_id)
        else:
            db_provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)
        return db_provider.to_entity()

    def create_provider(
        self,
        *,
        tenant_id: str,
        name: str,
        server_url: str,
        user_id: str,
        icon: str,
        icon_type: str,
        icon_background: str,
        server_identifier: str,
        timeout: float,
        sse_read_timeout: float,
        headers: dict[str, str] | None = None,
    ) -> ToolProviderApiEntity:
        """Create a new MCP provider."""
        server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()

        # Check for existing provider
        self._check_provider_exists(tenant_id, name, server_url_hash, server_identifier)

        # Encrypt sensitive data
        encrypted_server_url = encrypter.encrypt_token(tenant_id, server_url)
        encrypted_headers = self._prepare_encrypted_headers(headers, tenant_id) if headers else None

        # Create provider
        mcp_tool = MCPToolProvider(
            tenant_id=tenant_id,
            name=name,
            server_url=encrypted_server_url,
            server_url_hash=server_url_hash,
            user_id=user_id,
            authed=False,
            tools="[]",
            icon=self._prepare_icon(icon, icon_type, icon_background),
            server_identifier=server_identifier,
            timeout=timeout,
            sse_read_timeout=sse_read_timeout,
            encrypted_headers=encrypted_headers,
        )

        self._session.add(mcp_tool)
        self._session.commit()

        return ToolTransformService.mcp_provider_to_user_provider(mcp_tool, for_list=True)

    def update_provider(
        self,
        *,
        tenant_id: str,
        provider_id: str,
        name: str,
        server_url: str,
        icon: str,
        icon_type: str,
        icon_background: str,
        server_identifier: str,
        timeout: float | None = None,
        sse_read_timeout: float | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        """Update an MCP provider."""
        mcp_provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)

        reconnect_result = None
        encrypted_server_url = None
        server_url_hash = None

        # Handle server URL update
        if UNCHANGED_SERVER_URL_PLACEHOLDER not in server_url:
            encrypted_server_url = encrypter.encrypt_token(tenant_id, server_url)
            server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()

            if server_url_hash != mcp_provider.server_url_hash:
                reconnect_result = self._reconnect_provider(
                    server_url=server_url,
                    provider=mcp_provider,
                )

        try:
            # Update basic fields
            mcp_provider.updated_at = datetime.now()
            mcp_provider.name = name
            mcp_provider.icon = self._prepare_icon(icon, icon_type, icon_background)
            mcp_provider.server_identifier = server_identifier

            # Update server URL if changed
            if encrypted_server_url is not None and server_url_hash is not None:
                mcp_provider.server_url = encrypted_server_url
                mcp_provider.server_url_hash = server_url_hash

                if reconnect_result:
                    mcp_provider.authed = reconnect_result["authed"]
                    mcp_provider.tools = reconnect_result["tools"]
                    mcp_provider.encrypted_credentials = reconnect_result["encrypted_credentials"]

            # Update optional fields
            if timeout is not None:
                mcp_provider.timeout = timeout
            if sse_read_timeout is not None:
                mcp_provider.sse_read_timeout = sse_read_timeout
            if headers is not None:
                mcp_provider.encrypted_headers = (
                    self._prepare_encrypted_headers(headers, tenant_id) if headers else None
                )

            self._session.commit()

        except IntegrityError as e:
            self._session.rollback()
            self._handle_integrity_error(e, name, server_url, server_identifier)
        except Exception:
            self._session.rollback()
            raise

    def delete_provider(self, *, tenant_id: str, provider_id: str) -> None:
        """Delete an MCP provider."""
        mcp_tool = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)
        self._session.delete(mcp_tool)
        self._session.commit()

    def list_providers(self, *, tenant_id: str, for_list: bool = False) -> list[ToolProviderApiEntity]:
        """List all MCP providers for a tenant."""
        stmt = select(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant_id).order_by(MCPToolProvider.name)
        mcp_providers = self._session.scalars(stmt).all()

        return [
            ToolTransformService.mcp_provider_to_user_provider(provider, for_list=for_list)
            for provider in mcp_providers
        ]

    # ========== Tool Operations ==========

    def list_provider_tools(self, *, tenant_id: str, provider_id: str) -> ToolProviderApiEntity:
        """List tools from remote MCP server."""
        from core.mcp.auth.auth_flow import auth

        # Load provider and convert to entity
        db_provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)
        provider_entity = db_provider.to_entity()

        # Verify authentication
        if not provider_entity.authed:
            raise ValueError("Please auth the tool first")

        # Prepare headers with auth token
        headers = self._prepare_auth_headers(provider_entity)

        # Retrieve tools from remote server
        server_url = provider_entity.decrypt_server_url()
        try:
            tools = self._retrieve_remote_mcp_tools(
                server_url, headers, provider_entity, lambda p, s, c: auth(p, self, c)
            )
        except MCPError as e:
            raise ValueError(f"Failed to connect to MCP server: {e}")

        # Update database with retrieved tools
        db_provider.tools = json.dumps([tool.model_dump() for tool in tools])
        db_provider.authed = True
        db_provider.updated_at = datetime.now()
        self._session.commit()

        # Build API response
        return self._build_tool_provider_response(db_provider, provider_entity, tools)

    # ========== OAuth and Credentials Operations ==========

    def update_provider_credentials(
        self, *, provider: MCPToolProvider, credentials: dict[str, Any], authed: bool | None = None
    ) -> None:
        """
        Update provider credentials with encryption.

        Args:
            provider: Provider instance
            credentials: Credentials to save
            authed: Whether provider is authenticated (None means keep current state)
        """
        from core.tools.mcp_tool.provider import MCPToolProviderController

        # Encrypt new credentials
        provider_controller = MCPToolProviderController.from_db(provider)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=provider.tenant_id,
            config=list(provider_controller.get_credentials_schema()),
            provider_config_cache=NoOpProviderCredentialCache(),
        )
        encrypted_credentials = tool_configuration.encrypt(credentials)

        # Update provider
        provider.updated_at = datetime.now()
        provider.encrypted_credentials = json.dumps({**provider.credentials, **encrypted_credentials})

        if authed is not None:
            provider.authed = authed
            if not authed:
                provider.tools = "[]"

        self._session.commit()

    def save_oauth_data(self, provider_id: str, tenant_id: str, data: dict[str, Any], data_type: str = "mixed") -> None:
        """
        Save OAuth-related data (tokens, client info, code verifier).

        Args:
            provider_id: Provider ID
            tenant_id: Tenant ID
            data: Data to save (tokens, client info, or code verifier)
            data_type: Type of data ('tokens', 'client_info', 'code_verifier', 'mixed')
        """
        db_provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)

        credentials = {}
        authed = None

        if data_type == "tokens" or (data_type == "mixed" and "access_token" in data):
            # OAuth tokens
            credentials = data
            authed = True
        elif data_type == "client_info" or (data_type == "mixed" and "client_information" in data):
            # OAuth client information
            credentials = data
        elif data_type == "code_verifier" or (data_type == "mixed" and "code_verifier" in data):
            # PKCE code verifier
            credentials = data
        else:
            credentials = data

        self.update_provider_credentials(provider=db_provider, credentials=credentials, authed=authed)

    def clear_provider_credentials(self, *, provider: MCPToolProvider) -> None:
        """Clear all credentials for a provider."""
        provider.tools = "[]"
        provider.encrypted_credentials = "{}"
        provider.updated_at = datetime.now()
        provider.authed = False
        self._session.commit()

    # ========== Private Helper Methods ==========

    def _check_provider_exists(self, tenant_id: str, name: str, server_url_hash: str, server_identifier: str) -> None:
        """Check if provider with same attributes already exists."""
        stmt = select(MCPToolProvider).where(
            MCPToolProvider.tenant_id == tenant_id,
            or_(
                MCPToolProvider.name == name,
                MCPToolProvider.server_url_hash == server_url_hash,
                MCPToolProvider.server_identifier == server_identifier,
            ),
        )
        existing_provider = self._session.scalar(stmt)

        if existing_provider:
            if existing_provider.name == name:
                raise ValueError(f"MCP tool {name} already exists")
            if existing_provider.server_url_hash == server_url_hash:
                raise ValueError("MCP tool with this server URL already exists")
            if existing_provider.server_identifier == server_identifier:
                raise ValueError(f"MCP tool {server_identifier} already exists")

    def _prepare_icon(self, icon: str, icon_type: str, icon_background: str) -> str:
        """Prepare icon data for storage."""
        if icon_type == "emoji":
            return json.dumps({"content": icon, "background": icon_background})
        return icon

    def _prepare_encrypted_headers(self, headers: dict[str, str], tenant_id: str) -> str:
        """Encrypt headers and prepare for storage."""
        from core.entities.provider_entities import BasicProviderConfig
        from core.tools.utils.encryption import create_provider_encrypter

        # Create dynamic config for all headers as SECRET_INPUT
        config = [BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=key) for key in headers]

        encrypter_instance, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=config,
            cache=NoOpProviderCredentialCache(),
        )

        encrypted_headers_dict = encrypter_instance.encrypt(headers)
        return json.dumps(encrypted_headers_dict)

    def _prepare_auth_headers(self, provider_entity: MCPProviderEntity) -> dict[str, str]:
        """Prepare headers with OAuth token if available."""
        headers = provider_entity.headers.copy() if provider_entity.headers else {}
        tokens = provider_entity.retrieve_tokens()
        if tokens:
            headers["Authorization"] = f"{tokens.token_type.capitalize()} {tokens.access_token}"
        return headers

    def _retrieve_remote_mcp_tools(
        self,
        server_url: str,
        headers: dict[str, str],
        provider_entity: MCPProviderEntity,
        auth_callback: Callable[[MCPProviderEntity, "MCPToolManageService", Optional[str]], dict[str, str]],
    ):
        """Retrieve tools from remote MCP server."""
        with MCPClientWithAuthRetry(
            server_url,
            headers=headers,
            timeout=provider_entity.timeout,
            sse_read_timeout=provider_entity.sse_read_timeout,
            provider_entity=provider_entity,
            auth_callback=auth_callback,
            mcp_service=self,
        ) as mcp_client:
            return mcp_client.list_tools()

    def _reconnect_provider(self, *, server_url: str, provider: MCPToolProvider) -> dict[str, Any]:
        """Attempt to reconnect to MCP provider with new server URL."""
        from core.mcp.auth.auth_flow import auth

        provider_entity = provider.to_entity()
        headers = provider_entity.headers
        timeout = provider_entity.timeout
        sse_read_timeout = provider_entity.sse_read_timeout

        try:
            with MCPClientWithAuthRetry(
                server_url,
                headers=headers,
                timeout=timeout,
                sse_read_timeout=sse_read_timeout,
                provider_entity=provider_entity,
                auth_callback=lambda p, s, c: auth(p, self, c),
                mcp_service=self,
            ) as mcp_client:
                tools = mcp_client.list_tools()
                return {
                    "authed": True,
                    "tools": json.dumps([tool.model_dump() for tool in tools]),
                    "encrypted_credentials": "{}",
                }
        except MCPAuthError:
            return {"authed": False, "tools": "[]", "encrypted_credentials": "{}"}
        except MCPError as e:
            raise ValueError(f"Failed to re-connect MCP server: {e}") from e

    def _build_tool_provider_response(
        self, db_provider: MCPToolProvider, provider_entity: MCPProviderEntity, tools: list
    ) -> ToolProviderApiEntity:
        """Build API response for tool provider."""
        user = db_provider.load_user()
        response = provider_entity.to_api_response(
            user_name=user.name if user else None,
        )
        response["tools"] = ToolTransformService.mcp_tool_to_user_tool(db_provider, tools)
        response["plugin_unique_identifier"] = provider_entity.provider_id
        return ToolProviderApiEntity(**response)

    def _handle_integrity_error(
        self, error: IntegrityError, name: str, server_url: str, server_identifier: str
    ) -> None:
        """Handle database integrity errors with user-friendly messages."""
        error_msg = str(error.orig)
        if "unique_mcp_provider_name" in error_msg:
            raise ValueError(f"MCP tool {name} already exists")
        if "unique_mcp_provider_server_url" in error_msg:
            raise ValueError(f"MCP tool {server_url} already exists")
        if "unique_mcp_provider_server_identifier" in error_msg:
            raise ValueError(f"MCP tool {server_identifier} already exists")
        raise
