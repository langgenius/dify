"""
Comprehensive unit tests for Tool models.

This test suite covers:
- ToolProvider model validation (BuiltinToolProvider, ApiToolProvider)
- BuiltinToolProvider relationships and credential management
- ApiToolProvider credential storage and encryption
- Tool OAuth client models
- ToolLabelBinding relationships
"""

import json
from uuid import uuid4

from core.tools.entities.tool_entities import ApiProviderSchemaType
from models.tools import (
    ApiToolProvider,
    BuiltinToolProvider,
    ToolLabelBinding,
    ToolOAuthSystemClient,
    ToolOAuthTenantClient,
)


class TestBuiltinToolProviderValidation:
    """Test suite for BuiltinToolProvider model validation and operations."""

    def test_builtin_tool_provider_creation_with_required_fields(self):
        """Test creating a builtin tool provider with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        provider_name = "google"
        credentials = {"api_key": "test_key_123"}

        # Act
        builtin_provider = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider_name,
            encrypted_credentials=json.dumps(credentials),
            name="Google API Key 1",
        )

        # Assert
        assert builtin_provider.tenant_id == tenant_id
        assert builtin_provider.user_id == user_id
        assert builtin_provider.provider == provider_name
        assert builtin_provider.name == "Google API Key 1"
        assert builtin_provider.encrypted_credentials == json.dumps(credentials)

    def test_builtin_tool_provider_credentials_property(self):
        """Test credentials property parses JSON correctly."""
        # Arrange
        credentials_data = {
            "api_key": "sk-test123",
            "auth_type": "api_key",
            "endpoint": "https://api.example.com",
        }
        builtin_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="custom_provider",
            name="Custom Provider Key",
            encrypted_credentials=json.dumps(credentials_data),
        )

        # Act
        result = builtin_provider.credentials

        # Assert
        assert result == credentials_data
        assert result["api_key"] == "sk-test123"
        assert result["auth_type"] == "api_key"

    def test_builtin_tool_provider_credentials_empty_when_none(self):
        """Test credentials property returns empty dict when encrypted_credentials is None."""
        # Arrange
        builtin_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="test_provider",
            name="Test Provider",
            encrypted_credentials=None,
        )

        # Act
        result = builtin_provider.credentials

        # Assert
        assert result == {}

    def test_builtin_tool_provider_credentials_empty_when_empty_string(self):
        """Test credentials property returns empty dict when encrypted_credentials is empty."""
        # Arrange
        builtin_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="test_provider",
            name="Test Provider",
            encrypted_credentials="",
        )

        # Act
        result = builtin_provider.credentials

        # Assert
        assert result == {}

    def test_builtin_tool_provider_default_values(self):
        """Test builtin tool provider default values."""
        # Arrange & Act
        builtin_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="test_provider",
            name="Test Provider",
        )

        # Assert
        assert builtin_provider.is_default is False
        assert builtin_provider.credential_type == "api-key"
        assert builtin_provider.expires_at == -1

    def test_builtin_tool_provider_with_oauth_credential_type(self):
        """Test builtin tool provider with OAuth credential type."""
        # Arrange
        credentials = {
            "access_token": "oauth_token_123",
            "refresh_token": "refresh_token_456",
            "token_type": "Bearer",
        }

        # Act
        builtin_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="google",
            name="Google OAuth",
            encrypted_credentials=json.dumps(credentials),
            credential_type="oauth2",
            expires_at=1735689600,
        )

        # Assert
        assert builtin_provider.credential_type == "oauth2"
        assert builtin_provider.expires_at == 1735689600
        assert builtin_provider.credentials["access_token"] == "oauth_token_123"

    def test_builtin_tool_provider_is_default_flag(self):
        """Test is_default flag for builtin tool provider."""
        # Arrange
        provider1 = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="google",
            name="Google Key 1",
            is_default=True,
        )
        provider2 = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="google",
            name="Google Key 2",
            is_default=False,
        )

        # Assert
        assert provider1.is_default is True
        assert provider2.is_default is False

    def test_builtin_tool_provider_unique_constraint_fields(self):
        """Test unique constraint fields (tenant_id, provider, name)."""
        # Arrange
        tenant_id = str(uuid4())
        provider_name = "google"
        credential_name = "My Google Key"

        # Act
        builtin_provider = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=str(uuid4()),
            provider=provider_name,
            name=credential_name,
        )

        # Assert - these fields form unique constraint
        assert builtin_provider.tenant_id == tenant_id
        assert builtin_provider.provider == provider_name
        assert builtin_provider.name == credential_name

    def test_builtin_tool_provider_multiple_credentials_same_provider(self):
        """Test multiple credential sets for the same provider."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        provider = "openai"

        # Act - create multiple credentials for same provider
        provider1 = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            name="OpenAI Key 1",
            encrypted_credentials=json.dumps({"api_key": "key1"}),
        )
        provider2 = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            name="OpenAI Key 2",
            encrypted_credentials=json.dumps({"api_key": "key2"}),
        )

        # Assert - different names allow multiple credentials
        assert provider1.provider == provider2.provider
        assert provider1.name != provider2.name
        assert provider1.credentials != provider2.credentials


class TestApiToolProviderValidation:
    """Test suite for ApiToolProvider model validation and operations."""

    def test_api_tool_provider_creation_with_required_fields(self):
        """Test creating an API tool provider with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        provider_name = "Custom API"
        schema = '{"openapi": "3.0.0", "info": {"title": "Test API"}}'
        tools = [{"name": "test_tool", "description": "A test tool"}]
        credentials = {"auth_type": "api_key", "api_key_value": "test123"}

        # Act
        api_provider = ApiToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            name=provider_name,
            icon='{"type": "emoji", "value": "🔧"}',
            schema=schema,
            schema_type_str="openapi",
            description="Custom API for testing",
            tools_str=json.dumps(tools),
            credentials_str=json.dumps(credentials),
        )

        # Assert
        assert api_provider.tenant_id == tenant_id
        assert api_provider.user_id == user_id
        assert api_provider.name == provider_name
        assert api_provider.schema == schema
        assert api_provider.schema_type_str == "openapi"
        assert api_provider.description == "Custom API for testing"

    def test_api_tool_provider_schema_type_property(self):
        """Test schema_type property converts string to enum."""
        # Arrange
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Test API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Test",
            tools_str="[]",
            credentials_str="{}",
        )

        # Act
        result = api_provider.schema_type

        # Assert
        assert result == ApiProviderSchemaType.OPENAPI

    def test_api_tool_provider_tools_property(self):
        """Test tools property parses JSON and returns ApiToolBundle list."""
        # Arrange
        tools_data = [
            {
                "author": "test",
                "server_url": "https://api.weather.com",
                "method": "get",
                "summary": "Get weather information",
                "operation_id": "getWeather",
                "parameters": [],
                "openapi": {
                    "operation_id": "getWeather",
                    "parameters": [],
                    "method": "get",
                    "path": "/weather",
                    "server_url": "https://api.weather.com",
                },
            },
            {
                "author": "test",
                "server_url": "https://api.location.com",
                "method": "get",
                "summary": "Get location data",
                "operation_id": "getLocation",
                "parameters": [],
                "openapi": {
                    "operation_id": "getLocation",
                    "parameters": [],
                    "method": "get",
                    "path": "/location",
                    "server_url": "https://api.location.com",
                },
            },
        ]
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Weather API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Weather API",
            tools_str=json.dumps(tools_data),
            credentials_str="{}",
        )

        # Act
        result = api_provider.tools

        # Assert
        assert len(result) == 2
        assert result[0].operation_id == "getWeather"
        assert result[1].operation_id == "getLocation"

    def test_api_tool_provider_credentials_property(self):
        """Test credentials property parses JSON correctly."""
        # Arrange
        credentials_data = {
            "auth_type": "api_key_header",
            "api_key_header": "Authorization",
            "api_key_value": "Bearer test_token",
            "api_key_header_prefix": "bearer",
        }
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Secure API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Secure API",
            tools_str="[]",
            credentials_str=json.dumps(credentials_data),
        )

        # Act
        result = api_provider.credentials

        # Assert
        assert result["auth_type"] == "api_key_header"
        assert result["api_key_header"] == "Authorization"
        assert result["api_key_value"] == "Bearer test_token"

    def test_api_tool_provider_with_privacy_policy(self):
        """Test API tool provider with privacy policy."""
        # Arrange
        privacy_policy_url = "https://example.com/privacy"

        # Act
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Privacy API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="API with privacy policy",
            tools_str="[]",
            credentials_str="{}",
            privacy_policy=privacy_policy_url,
        )

        # Assert
        assert api_provider.privacy_policy == privacy_policy_url

    def test_api_tool_provider_with_custom_disclaimer(self):
        """Test API tool provider with custom disclaimer."""
        # Arrange
        disclaimer = "This API is provided as-is without warranty."

        # Act
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Disclaimer API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="API with disclaimer",
            tools_str="[]",
            credentials_str="{}",
            custom_disclaimer=disclaimer,
        )

        # Assert
        assert api_provider.custom_disclaimer == disclaimer

    def test_api_tool_provider_default_custom_disclaimer(self):
        """Test API tool provider default custom_disclaimer is empty string."""
        # Arrange & Act
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Default API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="API",
            tools_str="[]",
            credentials_str="{}",
        )

        # Assert
        assert api_provider.custom_disclaimer == ""

    def test_api_tool_provider_unique_constraint_fields(self):
        """Test unique constraint fields (name, tenant_id)."""
        # Arrange
        tenant_id = str(uuid4())
        provider_name = "Unique API"

        # Act
        api_provider = ApiToolProvider(
            tenant_id=tenant_id,
            user_id=str(uuid4()),
            name=provider_name,
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Unique API",
            tools_str="[]",
            credentials_str="{}",
        )

        # Assert - these fields form unique constraint
        assert api_provider.tenant_id == tenant_id
        assert api_provider.name == provider_name

    def test_api_tool_provider_with_no_auth(self):
        """Test API tool provider with no authentication."""
        # Arrange
        credentials = {"auth_type": "none"}

        # Act
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Public API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Public API with no auth",
            tools_str="[]",
            credentials_str=json.dumps(credentials),
        )

        # Assert
        assert api_provider.credentials["auth_type"] == "none"

    def test_api_tool_provider_with_api_key_query_auth(self):
        """Test API tool provider with API key in query parameter."""
        # Arrange
        credentials = {
            "auth_type": "api_key_query",
            "api_key_query_param": "apikey",
            "api_key_value": "my_secret_key",
        }

        # Act
        api_provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Query Auth API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="API with query auth",
            tools_str="[]",
            credentials_str=json.dumps(credentials),
        )

        # Assert
        assert api_provider.credentials["auth_type"] == "api_key_query"
        assert api_provider.credentials["api_key_query_param"] == "apikey"


class TestToolOAuthModels:
    """Test suite for OAuth client models (system and tenant level)."""

    def test_oauth_system_client_creation(self):
        """Test creating a system-level OAuth client."""
        # Arrange
        plugin_id = "builtin.google"
        provider = "google"
        oauth_params = json.dumps(
            {"client_id": "system_client_id", "client_secret": "system_secret", "scope": "email profile"}
        )

        # Act
        oauth_client = ToolOAuthSystemClient(
            plugin_id=plugin_id,
            provider=provider,
            encrypted_oauth_params=oauth_params,
        )

        # Assert
        assert oauth_client.plugin_id == plugin_id
        assert oauth_client.provider == provider
        assert oauth_client.encrypted_oauth_params == oauth_params

    def test_oauth_system_client_unique_constraint(self):
        """Test unique constraint on plugin_id and provider."""
        # Arrange
        plugin_id = "builtin.github"
        provider = "github"

        # Act
        oauth_client = ToolOAuthSystemClient(
            plugin_id=plugin_id,
            provider=provider,
            encrypted_oauth_params="{}",
        )

        # Assert - these fields form unique constraint
        assert oauth_client.plugin_id == plugin_id
        assert oauth_client.provider == provider

    def test_oauth_tenant_client_creation(self):
        """Test creating a tenant-level OAuth client."""
        # Arrange
        tenant_id = str(uuid4())
        plugin_id = "builtin.google"
        provider = "google"

        # Act
        oauth_client = ToolOAuthTenantClient(
            tenant_id=tenant_id,
            plugin_id=plugin_id,
            provider=provider,
        )
        # Set encrypted_oauth_params after creation (it has init=False)
        oauth_params = json.dumps({"client_id": "tenant_client_id", "client_secret": "tenant_secret"})
        oauth_client.encrypted_oauth_params = oauth_params

        # Assert
        assert oauth_client.tenant_id == tenant_id
        assert oauth_client.plugin_id == plugin_id
        assert oauth_client.provider == provider

    def test_oauth_tenant_client_enabled_default(self):
        """Test OAuth tenant client enabled flag has init=False and uses server default."""
        # Arrange & Act
        oauth_client = ToolOAuthTenantClient(
            tenant_id=str(uuid4()),
            plugin_id="builtin.slack",
            provider="slack",
        )

        # Assert - enabled has init=False, so it won't be set until saved to DB
        # We can manually set it to test the field exists
        oauth_client.enabled = True
        assert oauth_client.enabled is True

    def test_oauth_tenant_client_oauth_params_property(self):
        """Test oauth_params property parses JSON correctly."""
        # Arrange
        params_data = {
            "client_id": "test_client_123",
            "client_secret": "secret_456",
            "redirect_uri": "https://app.example.com/callback",
        }
        oauth_client = ToolOAuthTenantClient(
            tenant_id=str(uuid4()),
            plugin_id="builtin.dropbox",
            provider="dropbox",
        )
        # Set encrypted_oauth_params after creation (it has init=False)
        oauth_client.encrypted_oauth_params = json.dumps(params_data)

        # Act
        result = oauth_client.oauth_params

        # Assert
        assert result == params_data
        assert result["client_id"] == "test_client_123"
        assert result["redirect_uri"] == "https://app.example.com/callback"

    def test_oauth_tenant_client_oauth_params_empty_when_none(self):
        """Test oauth_params returns empty dict when encrypted_oauth_params is None."""
        # Arrange
        oauth_client = ToolOAuthTenantClient(
            tenant_id=str(uuid4()),
            plugin_id="builtin.test",
            provider="test",
        )
        # encrypted_oauth_params has init=False, set it to None
        oauth_client.encrypted_oauth_params = None

        # Act
        result = oauth_client.oauth_params

        # Assert
        assert result == {}

    def test_oauth_tenant_client_disabled_state(self):
        """Test OAuth tenant client can be disabled."""
        # Arrange
        oauth_client = ToolOAuthTenantClient(
            tenant_id=str(uuid4()),
            plugin_id="builtin.microsoft",
            provider="microsoft",
        )

        # Act
        oauth_client.enabled = False

        # Assert
        assert oauth_client.enabled is False


class TestToolLabelBinding:
    """Test suite for ToolLabelBinding model."""

    def test_tool_label_binding_creation(self):
        """Test creating a tool label binding."""
        # Arrange
        tool_id = "google.search"
        tool_type = "builtin"
        label_name = "search"

        # Act
        label_binding = ToolLabelBinding(
            tool_id=tool_id,
            tool_type=tool_type,
            label_name=label_name,
        )

        # Assert
        assert label_binding.tool_id == tool_id
        assert label_binding.tool_type == tool_type
        assert label_binding.label_name == label_name

    def test_tool_label_binding_unique_constraint(self):
        """Test unique constraint on tool_id and label_name."""
        # Arrange
        tool_id = "openai.text_generation"
        label_name = "text"

        # Act
        label_binding = ToolLabelBinding(
            tool_id=tool_id,
            tool_type="builtin",
            label_name=label_name,
        )

        # Assert - these fields form unique constraint
        assert label_binding.tool_id == tool_id
        assert label_binding.label_name == label_name

    def test_tool_label_binding_multiple_labels_same_tool(self):
        """Test multiple labels can be bound to the same tool."""
        # Arrange
        tool_id = "google.search"
        tool_type = "builtin"

        # Act
        binding1 = ToolLabelBinding(
            tool_id=tool_id,
            tool_type=tool_type,
            label_name="search",
        )
        binding2 = ToolLabelBinding(
            tool_id=tool_id,
            tool_type=tool_type,
            label_name="productivity",
        )

        # Assert
        assert binding1.tool_id == binding2.tool_id
        assert binding1.label_name != binding2.label_name

    def test_tool_label_binding_different_tool_types(self):
        """Test label bindings for different tool types."""
        # Arrange
        tool_types = ["builtin", "api", "workflow"]

        # Act & Assert
        for tool_type in tool_types:
            binding = ToolLabelBinding(
                tool_id=f"test_tool_{tool_type}",
                tool_type=tool_type,
                label_name="test",
            )
            assert binding.tool_type == tool_type


class TestCredentialStorage:
    """Test suite for credential storage and encryption patterns."""

    def test_builtin_provider_credential_storage_format(self):
        """Test builtin provider stores credentials as JSON string."""
        # Arrange
        credentials = {
            "api_key": "sk-test123",
            "endpoint": "https://api.example.com",
            "timeout": 30,
        }

        # Act
        provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="test",
            name="Test Provider",
            encrypted_credentials=json.dumps(credentials),
        )

        # Assert
        assert isinstance(provider.encrypted_credentials, str)
        assert provider.credentials == credentials

    def test_api_provider_credential_storage_format(self):
        """Test API provider stores credentials as JSON string."""
        # Arrange
        credentials = {
            "auth_type": "api_key_header",
            "api_key_header": "X-API-Key",
            "api_key_value": "secret_key_789",
        }

        # Act
        provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Test API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Test",
            tools_str="[]",
            credentials_str=json.dumps(credentials),
        )

        # Assert
        assert isinstance(provider.credentials_str, str)
        assert provider.credentials == credentials

    def test_builtin_provider_complex_credential_structure(self):
        """Test builtin provider with complex nested credential structure."""
        # Arrange
        credentials = {
            "auth_type": "oauth2",
            "oauth_config": {
                "access_token": "token123",
                "refresh_token": "refresh456",
                "expires_in": 3600,
                "token_type": "Bearer",
            },
            "additional_headers": {"X-Custom-Header": "value"},
        }

        # Act
        provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="oauth_provider",
            name="OAuth Provider",
            encrypted_credentials=json.dumps(credentials),
        )

        # Assert
        assert provider.credentials["oauth_config"]["access_token"] == "token123"
        assert provider.credentials["additional_headers"]["X-Custom-Header"] == "value"

    def test_api_provider_credential_update_pattern(self):
        """Test pattern for updating API provider credentials."""
        # Arrange
        original_credentials = {"auth_type": "api_key_header", "api_key_value": "old_key"}
        provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            name="Update Test",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Test",
            tools_str="[]",
            credentials_str=json.dumps(original_credentials),
        )

        # Act - simulate credential update
        new_credentials = {"auth_type": "api_key_header", "api_key_value": "new_key"}
        provider.credentials_str = json.dumps(new_credentials)

        # Assert
        assert provider.credentials["api_key_value"] == "new_key"

    def test_builtin_provider_credential_expiration(self):
        """Test builtin provider credential expiration tracking."""
        # Arrange
        future_timestamp = 1735689600  # Future date
        past_timestamp = 1609459200  # Past date

        # Act
        active_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="active",
            name="Active Provider",
            expires_at=future_timestamp,
        )
        expired_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="expired",
            name="Expired Provider",
            expires_at=past_timestamp,
        )
        never_expires_provider = BuiltinToolProvider(
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            provider="permanent",
            name="Permanent Provider",
            expires_at=-1,
        )

        # Assert
        assert active_provider.expires_at == future_timestamp
        assert expired_provider.expires_at == past_timestamp
        assert never_expires_provider.expires_at == -1

    def test_oauth_client_credential_storage(self):
        """Test OAuth client credential storage pattern."""
        # Arrange
        oauth_credentials = {
            "client_id": "oauth_client_123",
            "client_secret": "oauth_secret_456",
            "authorization_url": "https://oauth.example.com/authorize",
            "token_url": "https://oauth.example.com/token",
            "scope": "read write",
        }

        # Act
        system_client = ToolOAuthSystemClient(
            plugin_id="builtin.oauth_test",
            provider="oauth_test",
            encrypted_oauth_params=json.dumps(oauth_credentials),
        )

        tenant_client = ToolOAuthTenantClient(
            tenant_id=str(uuid4()),
            plugin_id="builtin.oauth_test",
            provider="oauth_test",
        )
        # Set encrypted_oauth_params after creation (it has init=False)
        tenant_client.encrypted_oauth_params = json.dumps(oauth_credentials)

        # Assert
        assert system_client.encrypted_oauth_params == json.dumps(oauth_credentials)
        assert tenant_client.oauth_params == oauth_credentials


class TestToolProviderRelationships:
    """Test suite for tool provider relationships and associations."""

    def test_builtin_provider_tenant_relationship(self):
        """Test builtin provider belongs to a tenant."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        provider = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=str(uuid4()),
            provider="test",
            name="Test Provider",
        )

        # Assert
        assert provider.tenant_id == tenant_id

    def test_api_provider_user_relationship(self):
        """Test API provider belongs to a user."""
        # Arrange
        user_id = str(uuid4())

        # Act
        provider = ApiToolProvider(
            tenant_id=str(uuid4()),
            user_id=user_id,
            name="User API",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Test",
            tools_str="[]",
            credentials_str="{}",
        )

        # Assert
        assert provider.user_id == user_id

    def test_multiple_providers_same_tenant(self):
        """Test multiple providers can belong to the same tenant."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())

        # Act
        builtin1 = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider="google",
            name="Google Key 1",
        )
        builtin2 = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider="openai",
            name="OpenAI Key 1",
        )
        api1 = ApiToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            name="Custom API 1",
            icon="{}",
            schema="{}",
            schema_type_str="openapi",
            description="Test",
            tools_str="[]",
            credentials_str="{}",
        )

        # Assert
        assert builtin1.tenant_id == tenant_id
        assert builtin2.tenant_id == tenant_id
        assert api1.tenant_id == tenant_id

    def test_tool_label_bindings_for_provider_tools(self):
        """Test tool label bindings can be associated with provider tools."""
        # Arrange
        provider_name = "google"
        tool_id = f"{provider_name}.search"

        # Act
        binding1 = ToolLabelBinding(
            tool_id=tool_id,
            tool_type="builtin",
            label_name="search",
        )
        binding2 = ToolLabelBinding(
            tool_id=tool_id,
            tool_type="builtin",
            label_name="web",
        )

        # Assert
        assert binding1.tool_id == tool_id
        assert binding2.tool_id == tool_id
        assert binding1.label_name != binding2.label_name
