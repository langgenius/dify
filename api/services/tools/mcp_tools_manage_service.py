import hashlib
import json
import logging
from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration, MCPProviderEntity
from core.helper import encrypter
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.mcp.auth.auth_flow import auth
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError, MCPError
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.utils.encryption import ProviderConfigEncrypter
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)

# Constants
UNCHANGED_SERVER_URL_PLACEHOLDER = "[__HIDDEN__]"
CLIENT_NAME = "Dify"
EMPTY_TOOLS_JSON = "[]"
EMPTY_CREDENTIALS_JSON = "{}"


class OAuthDataType(StrEnum):
    """Types of OAuth data that can be saved."""

    TOKENS = "tokens"
    CLIENT_INFO = "client_info"
    CODE_VERIFIER = "code_verifier"
    MIXED = "mixed"


class ReconnectResult(BaseModel):
    """Result of reconnecting to an MCP provider"""

    authed: bool = Field(description="Whether the provider is authenticated")
    tools: str = Field(description="JSON string of tool list")
    encrypted_credentials: str = Field(description="JSON string of encrypted credentials")


class ServerUrlValidationResult(BaseModel):
    """Result of server URL validation check"""

    needs_validation: bool
    validation_passed: bool = False
    reconnect_result: ReconnectResult | None = None
    encrypted_server_url: str | None = None
    server_url_hash: str | None = None

    @property
    def should_update_server_url(self) -> bool:
        """Check if server URL should be updated based on validation result"""
        return self.needs_validation and self.validation_passed and self.reconnect_result is not None


class ProviderUrlValidationData(BaseModel):
    """Data required for URL validation, extracted from database to perform network operations outside of session"""

    current_server_url_hash: str
    headers: dict[str, str]
    timeout: float | None
    sse_read_timeout: float | None


class MCPToolManageService:
    """Service class for managing MCP tools and providers."""

    def __init__(self, session: Session):
        self._session = session

    # ========== Provider CRUD Operations ==========

    def get_provider(
        self, *, provider_id: str | None = None, server_identifier: str | None = None, tenant_id: str
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
        configuration: MCPConfiguration,
        authentication: MCPAuthentication | None = None,
        headers: dict[str, str] | None = None,
    ) -> ToolProviderApiEntity:
        """Create a new MCP provider."""
        # Validate URL format
        if not self._is_valid_url(server_url):
            raise ValueError("Server URL is not valid.")

        server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()

        # Check for existing provider
        self._check_provider_exists(tenant_id, name, server_url_hash, server_identifier)

        # Encrypt sensitive data
        encrypted_server_url = encrypter.encrypt_token(tenant_id, server_url)
        encrypted_headers = self._prepare_encrypted_dict(headers, tenant_id) if headers else None
        encrypted_credentials = None
        if authentication is not None and authentication.client_id:
            encrypted_credentials = self._build_and_encrypt_credentials(
                authentication.client_id, authentication.client_secret, tenant_id
            )

        # Create provider
        mcp_tool = MCPToolProvider(
            tenant_id=tenant_id,
            name=name,
            server_url=encrypted_server_url,
            server_url_hash=server_url_hash,
            user_id=user_id,
            authed=False,
            tools=EMPTY_TOOLS_JSON,
            icon=self._prepare_icon(icon, icon_type, icon_background),
            server_identifier=server_identifier,
            timeout=configuration.timeout,
            sse_read_timeout=configuration.sse_read_timeout,
            encrypted_headers=encrypted_headers,
            encrypted_credentials=encrypted_credentials,
        )

        self._session.add(mcp_tool)
        self._session.flush()

        mcp_providers = ToolTransformService.mcp_provider_to_user_provider(mcp_tool, for_list=True)
        return mcp_providers

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
        headers: dict[str, str] | None = None,
        configuration: MCPConfiguration,
        authentication: MCPAuthentication | None = None,
        validation_result: ServerUrlValidationResult | None = None,
    ) -> None:
        """
        Update an MCP provider.

        Args:
            validation_result: Pre-validation result from validate_server_url_standalone.
                              If provided and contains reconnect_result, it will be used
                              instead of performing network operations.
        """
        mcp_provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)

        # Check for duplicate name (excluding current provider)
        if name != mcp_provider.name:
            stmt = select(MCPToolProvider).where(
                MCPToolProvider.tenant_id == tenant_id,
                MCPToolProvider.name == name,
                MCPToolProvider.id != provider_id,
            )
            existing_provider = self._session.scalar(stmt)
            if existing_provider:
                raise ValueError(f"MCP tool {name} already exists")

        # Get URL update data from validation result
        encrypted_server_url = None
        server_url_hash = None
        reconnect_result = None

        if validation_result and validation_result.encrypted_server_url:
            # Use all data from validation result
            encrypted_server_url = validation_result.encrypted_server_url
            server_url_hash = validation_result.server_url_hash
            reconnect_result = validation_result.reconnect_result

        try:
            # Update basic fields
            mcp_provider.updated_at = datetime.now()
            mcp_provider.name = name
            mcp_provider.icon = self._prepare_icon(icon, icon_type, icon_background)
            mcp_provider.server_identifier = server_identifier

            # Update server URL if changed
            if encrypted_server_url and server_url_hash:
                mcp_provider.server_url = encrypted_server_url
                mcp_provider.server_url_hash = server_url_hash

                if reconnect_result:
                    mcp_provider.authed = reconnect_result.authed
                    mcp_provider.tools = reconnect_result.tools
                    mcp_provider.encrypted_credentials = reconnect_result.encrypted_credentials

            # Update optional configuration fields
            self._update_optional_fields(mcp_provider, configuration)

            # Update headers if provided
            if headers is not None:
                mcp_provider.encrypted_headers = self._process_headers(headers, mcp_provider, tenant_id)

            # Update credentials if provided
            if authentication and authentication.client_id:
                mcp_provider.encrypted_credentials = self._process_credentials(authentication, mcp_provider, tenant_id)

            # Flush changes to database
            self._session.flush()

        except IntegrityError as e:
            self._handle_integrity_error(e, name, server_url, server_identifier)

    def delete_provider(self, *, tenant_id: str, provider_id: str) -> None:
        """Delete an MCP provider."""
        mcp_tool = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)
        self._session.delete(mcp_tool)

    def list_providers(
        self, *, tenant_id: str, for_list: bool = False, include_sensitive: bool = True
    ) -> list[ToolProviderApiEntity]:
        """List all MCP providers for a tenant.

        Args:
            tenant_id: Tenant ID
            for_list: If True, return provider ID; if False, return server identifier
            include_sensitive: If False, skip expensive decryption operations (default: True for backward compatibility)
        """
        from models.account import Account

        stmt = select(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant_id).order_by(MCPToolProvider.name)
        mcp_providers = self._session.scalars(stmt).all()

        if not mcp_providers:
            return []

        # Batch query all users to avoid N+1 problem
        user_ids = {provider.user_id for provider in mcp_providers}
        users = self._session.query(Account).where(Account.id.in_(user_ids)).all()
        user_name_map = {user.id: user.name for user in users}

        return [
            ToolTransformService.mcp_provider_to_user_provider(
                provider,
                for_list=for_list,
                user_name=user_name_map.get(provider.user_id),
                include_sensitive=include_sensitive,
            )
            for provider in mcp_providers
        ]

    # ========== Tool Operations ==========

    def list_provider_tools(self, *, tenant_id: str, provider_id: str) -> ToolProviderApiEntity:
        """List tools from remote MCP server."""
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
            tools = self._retrieve_remote_mcp_tools(server_url, headers, provider_entity)
        except MCPError as e:
            raise ValueError(f"Failed to connect to MCP server: {e}")

        # Update database with retrieved tools (ensure description is a non-null string)
        tools_payload = []
        for tool in tools:
            data = tool.model_dump()
            if data.get("description") is None:
                data["description"] = ""
            tools_payload.append(data)
        db_provider.tools = json.dumps(tools_payload)
        db_provider.authed = True
        db_provider.updated_at = datetime.now()
        self._session.flush()

        # Build API response
        return self._build_tool_provider_response(db_provider, provider_entity, tools)

    # ========== OAuth and Credentials Operations ==========

    def update_provider_credentials(
        self, *, provider_id: str, tenant_id: str, credentials: dict[str, Any], authed: bool | None = None
    ) -> None:
        """
        Update provider credentials with encryption.

        Args:
            provider_id: Provider ID
            tenant_id: Tenant ID
            credentials: Credentials to save
            authed: Whether provider is authenticated (None means keep current state)
        """
        from core.tools.mcp_tool.provider import MCPToolProviderController

        # Get provider from current session
        provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)

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
                provider.tools = EMPTY_TOOLS_JSON

        # Flush changes to database
        self._session.flush()

    def save_oauth_data(
        self, provider_id: str, tenant_id: str, data: dict[str, Any], data_type: OAuthDataType = OAuthDataType.MIXED
    ) -> None:
        """
        Save OAuth-related data (tokens, client info, code verifier).

        Args:
            provider_id: Provider ID
            tenant_id: Tenant ID
            data: Data to save (tokens, client info, or code verifier)
            data_type: Type of OAuth data to save
        """
        # Determine if this makes the provider authenticated
        authed = (
            data_type == OAuthDataType.TOKENS or (data_type == OAuthDataType.MIXED and "access_token" in data) or None
        )

        # update_provider_credentials will validate provider existence
        self.update_provider_credentials(provider_id=provider_id, tenant_id=tenant_id, credentials=data, authed=authed)

    def clear_provider_credentials(self, *, provider_id: str, tenant_id: str) -> None:
        """
        Clear all credentials for a provider.

        Args:
            provider_id: Provider ID
            tenant_id: Tenant ID
        """
        # Get provider from current session
        provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)

        provider.tools = EMPTY_TOOLS_JSON
        provider.encrypted_credentials = EMPTY_CREDENTIALS_JSON
        provider.updated_at = datetime.now()
        provider.authed = False

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

    def _encrypt_dict_fields(self, data: dict[str, Any], secret_fields: list[str], tenant_id: str) -> Mapping[str, str]:
        """Encrypt specified fields in a dictionary.

        Args:
            data: Dictionary containing data to encrypt
            secret_fields: List of field names to encrypt
            tenant_id: Tenant ID for encryption

        Returns:
            JSON string of encrypted data
        """
        from core.entities.provider_entities import BasicProviderConfig
        from core.tools.utils.encryption import create_provider_encrypter

        # Create config for secret fields
        config = [
            BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name=field) for field in secret_fields
        ]

        encrypter_instance, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=config,
            cache=NoOpProviderCredentialCache(),
        )

        encrypted_data = encrypter_instance.encrypt(data)
        return encrypted_data

    def _prepare_encrypted_dict(self, headers: dict[str, str], tenant_id: str) -> str:
        """Encrypt headers and prepare for storage."""
        # All headers are treated as secret
        return json.dumps(self._encrypt_dict_fields(headers, list(headers.keys()), tenant_id))

    def _prepare_auth_headers(self, provider_entity: MCPProviderEntity) -> dict[str, str]:
        """Prepare headers with OAuth token if available."""
        headers = provider_entity.decrypt_headers()
        tokens = provider_entity.retrieve_tokens()
        if tokens:
            headers["Authorization"] = f"{tokens.token_type.capitalize()} {tokens.access_token}"
        return headers

    def _retrieve_remote_mcp_tools(
        self,
        server_url: str,
        headers: dict[str, str],
        provider_entity: MCPProviderEntity,
    ):
        """Retrieve tools from remote MCP server."""
        with MCPClientWithAuthRetry(
            server_url=server_url,
            headers=headers,
            timeout=provider_entity.timeout,
            sse_read_timeout=provider_entity.sse_read_timeout,
            provider_entity=provider_entity,
        ) as mcp_client:
            return mcp_client.list_tools()

    def execute_auth_actions(self, auth_result: Any) -> dict[str, str]:
        """
        Execute the actions returned by the auth function.

        This method processes the AuthResult and performs the necessary database operations.

        Args:
            auth_result: The result from the auth function

        Returns:
            The response from the auth result
        """
        from core.mcp.entities import AuthAction, AuthActionType

        action: AuthAction
        for action in auth_result.actions:
            if action.provider_id is None or action.tenant_id is None:
                continue

            if action.action_type == AuthActionType.SAVE_CLIENT_INFO:
                self.save_oauth_data(action.provider_id, action.tenant_id, action.data, OAuthDataType.CLIENT_INFO)
            elif action.action_type == AuthActionType.SAVE_TOKENS:
                self.save_oauth_data(action.provider_id, action.tenant_id, action.data, OAuthDataType.TOKENS)
            elif action.action_type == AuthActionType.SAVE_CODE_VERIFIER:
                self.save_oauth_data(action.provider_id, action.tenant_id, action.data, OAuthDataType.CODE_VERIFIER)

        return auth_result.response

    def auth_with_actions(
        self,
        provider_entity: MCPProviderEntity,
        authorization_code: str | None = None,
        resource_metadata_url: str | None = None,
        scope_hint: str | None = None,
    ) -> dict[str, str]:
        """
        Perform authentication and execute all resulting actions.

        This method is used by MCPClientWithAuthRetry for automatic re-authentication.

        Args:
            provider_entity: The MCP provider entity
            authorization_code: Optional authorization code
            resource_metadata_url: Optional Protected Resource Metadata URL from WWW-Authenticate
            scope_hint: Optional scope hint from WWW-Authenticate header

        Returns:
            Response dictionary from auth result
        """
        auth_result = auth(
            provider_entity,
            authorization_code,
            resource_metadata_url=resource_metadata_url,
            scope_hint=scope_hint,
        )
        return self.execute_auth_actions(auth_result)

    def get_provider_for_url_validation(self, *, tenant_id: str, provider_id: str) -> ProviderUrlValidationData:
        """
        Get provider data required for URL validation.
        This method performs database read and should be called within a session.

        Returns:
            ProviderUrlValidationData: Data needed for standalone URL validation
        """
        provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)
        provider_entity = provider.to_entity()
        return ProviderUrlValidationData(
            current_server_url_hash=provider.server_url_hash,
            headers=provider_entity.headers,
            timeout=provider_entity.timeout,
            sse_read_timeout=provider_entity.sse_read_timeout,
        )

    @staticmethod
    def validate_server_url_standalone(
        *,
        tenant_id: str,
        new_server_url: str,
        validation_data: ProviderUrlValidationData,
    ) -> ServerUrlValidationResult:
        """
        Validate server URL change by attempting to connect to the new server.
        This method performs network operations and MUST be called OUTSIDE of any database session
        to avoid holding locks during network I/O.

        Args:
            tenant_id: Tenant ID for encryption
            new_server_url: The new server URL to validate
            validation_data: Provider data obtained from get_provider_for_url_validation

        Returns:
            ServerUrlValidationResult: Validation result with connection status and tools if successful
        """
        # Handle hidden/unchanged URL
        if UNCHANGED_SERVER_URL_PLACEHOLDER in new_server_url:
            return ServerUrlValidationResult(needs_validation=False)

        # Validate URL format
        parsed = urlparse(new_server_url)
        if not all([parsed.scheme, parsed.netloc]) or parsed.scheme not in ["http", "https"]:
            raise ValueError("Server URL is not valid.")

        # Always encrypt and hash the URL
        encrypted_server_url = encrypter.encrypt_token(tenant_id, new_server_url)
        new_server_url_hash = hashlib.sha256(new_server_url.encode()).hexdigest()

        # Check if URL is actually different
        if new_server_url_hash == validation_data.current_server_url_hash:
            # URL hasn't changed, but still return the encrypted data
            return ServerUrlValidationResult(
                needs_validation=False,
                encrypted_server_url=encrypted_server_url,
                server_url_hash=new_server_url_hash,
            )

        # Perform network validation - this is the expensive operation that should be outside session
        reconnect_result = MCPToolManageService._reconnect_with_url(
            server_url=new_server_url,
            headers=validation_data.headers,
            timeout=validation_data.timeout,
            sse_read_timeout=validation_data.sse_read_timeout,
        )
        return ServerUrlValidationResult(
            needs_validation=True,
            validation_passed=True,
            reconnect_result=reconnect_result,
            encrypted_server_url=encrypted_server_url,
            server_url_hash=new_server_url_hash,
        )

    @staticmethod
    def reconnect_with_url(
        *,
        server_url: str,
        headers: dict[str, str],
        timeout: float | None,
        sse_read_timeout: float | None,
    ) -> ReconnectResult:
        return MCPToolManageService._reconnect_with_url(
            server_url=server_url,
            headers=headers,
            timeout=timeout,
            sse_read_timeout=sse_read_timeout,
        )

    @staticmethod
    def _reconnect_with_url(
        *,
        server_url: str,
        headers: dict[str, str],
        timeout: float | None,
        sse_read_timeout: float | None,
    ) -> ReconnectResult:
        """
        Attempt to connect to MCP server with given URL.
        This is a static method that performs network I/O without database access.
        """
        from core.mcp.mcp_client import MCPClient

        try:
            with MCPClient(
                server_url=server_url,
                headers=headers,
                timeout=timeout,
                sse_read_timeout=sse_read_timeout,
            ) as mcp_client:
                tools = mcp_client.list_tools()
                # Ensure tool descriptions are non-null in payload
                tools_payload = []
                for t in tools:
                    d = t.model_dump()
                    if d.get("description") is None:
                        d["description"] = ""
                    tools_payload.append(d)
                return ReconnectResult(
                    authed=True,
                    tools=json.dumps(tools_payload),
                    encrypted_credentials=EMPTY_CREDENTIALS_JSON,
                )
        except MCPAuthError:
            return ReconnectResult(authed=False, tools=EMPTY_TOOLS_JSON, encrypted_credentials=EMPTY_CREDENTIALS_JSON)
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

    def _is_valid_url(self, url: str) -> bool:
        """Validate URL format."""
        if not url:
            return False
        try:
            parsed = urlparse(url)
            return all([parsed.scheme, parsed.netloc]) and parsed.scheme in ["http", "https"]
        except (ValueError, TypeError):
            return False

    def _update_optional_fields(self, mcp_provider: MCPToolProvider, configuration: MCPConfiguration) -> None:
        """Update optional configuration fields using setattr for cleaner code."""
        field_mapping = {"timeout": configuration.timeout, "sse_read_timeout": configuration.sse_read_timeout}

        for field, value in field_mapping.items():
            if value is not None:
                setattr(mcp_provider, field, value)

    def _process_headers(self, headers: dict[str, str], mcp_provider: MCPToolProvider, tenant_id: str) -> str | None:
        """Process headers update, handling empty dict to clear headers."""
        if not headers:
            return None

        # Merge with existing headers to preserve masked values
        final_headers = self._merge_headers_with_masked(incoming_headers=headers, mcp_provider=mcp_provider)
        return self._prepare_encrypted_dict(final_headers, tenant_id)

    def _process_credentials(
        self, authentication: MCPAuthentication, mcp_provider: MCPToolProvider, tenant_id: str
    ) -> str:
        """Process credentials update, handling masked values."""
        # Merge with existing credentials
        final_client_id, final_client_secret = self._merge_credentials_with_masked(
            authentication.client_id, authentication.client_secret, mcp_provider
        )

        # Build and encrypt
        return self._build_and_encrypt_credentials(final_client_id, final_client_secret, tenant_id)

    def _merge_headers_with_masked(
        self, incoming_headers: dict[str, str], mcp_provider: MCPToolProvider
    ) -> dict[str, str]:
        """Merge incoming headers with existing ones, preserving unchanged masked values.

        Args:
            incoming_headers: Headers from frontend (may contain masked values)
            mcp_provider: The MCP provider instance

        Returns:
            Final headers dict with proper values (original for unchanged masked, new for changed)
        """
        mcp_provider_entity = mcp_provider.to_entity()
        existing_decrypted = mcp_provider_entity.decrypt_headers()
        existing_masked = mcp_provider_entity.masked_headers()

        return {
            key: (str(existing_decrypted[key]) if key in existing_masked and value == existing_masked[key] else value)
            for key, value in incoming_headers.items()
            if key in existing_decrypted or value != existing_masked.get(key)
        }

    def _merge_credentials_with_masked(
        self,
        client_id: str,
        client_secret: str | None,
        mcp_provider: MCPToolProvider,
    ) -> tuple[
        str,
        str | None,
    ]:
        """Merge incoming credentials with existing ones, preserving unchanged masked values.

        Args:
            client_id: Client ID from frontend (may be masked)
            client_secret: Client secret from frontend (may be masked)
            mcp_provider: The MCP provider instance

        Returns:
            Tuple of (final_client_id, final_client_secret)
        """
        mcp_provider_entity = mcp_provider.to_entity()
        existing_decrypted = mcp_provider_entity.decrypt_credentials()
        existing_masked = mcp_provider_entity.masked_credentials()

        # Check if client_id is masked and unchanged
        final_client_id = client_id
        if existing_masked.get("client_id") and client_id == existing_masked["client_id"]:
            # Use existing decrypted value
            final_client_id = existing_decrypted.get("client_id", client_id)

        # Check if client_secret is masked and unchanged
        final_client_secret = client_secret
        if existing_masked.get("client_secret") and client_secret == existing_masked["client_secret"]:
            # Use existing decrypted value
            final_client_secret = existing_decrypted.get("client_secret", client_secret)

        return final_client_id, final_client_secret

    def _build_and_encrypt_credentials(self, client_id: str, client_secret: str | None, tenant_id: str) -> str:
        """Build credentials and encrypt sensitive fields."""
        # Create a flat structure with all credential data
        credentials_data = {
            "client_id": client_id,
            "client_name": CLIENT_NAME,
            "is_dynamic_registration": False,
        }
        secret_fields = []
        if client_secret is not None:
            credentials_data["encrypted_client_secret"] = client_secret
            secret_fields = ["encrypted_client_secret"]
        client_info = self._encrypt_dict_fields(credentials_data, secret_fields, tenant_id)
        return json.dumps({"client_information": client_info})
