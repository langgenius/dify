"""Unit tests for MCP OAuth authentication flow."""

from unittest.mock import Mock, patch

import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth.auth_flow import (
    OAUTH_STATE_EXPIRY_SECONDS,
    OAUTH_STATE_REDIS_KEY_PREFIX,
    OAuthCallbackState,
    _create_secure_redis_state,
    _retrieve_redis_state,
    auth,
    check_support_resource_discovery,
    discover_oauth_metadata,
    exchange_authorization,
    generate_pkce_challenge,
    handle_callback,
    refresh_authorization,
    register_client,
    start_authorization,
)
from core.mcp.entities import AuthActionType, AuthResult
from core.mcp.types import (
    OAuthClientInformation,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthTokens,
)


class TestPKCEGeneration:
    """Test PKCE challenge generation."""

    def test_generate_pkce_challenge(self):
        """Test PKCE challenge and verifier generation."""
        code_verifier, code_challenge = generate_pkce_challenge()

        # Verify format - should be URL-safe base64 without padding
        assert "=" not in code_verifier
        assert "+" not in code_verifier
        assert "/" not in code_verifier
        assert "=" not in code_challenge
        assert "+" not in code_challenge
        assert "/" not in code_challenge

        # Verify length
        assert len(code_verifier) > 40  # Should be around 54 characters
        assert len(code_challenge) > 40  # Should be around 43 characters

    def test_generate_pkce_challenge_uniqueness(self):
        """Test that PKCE generation produces unique values."""
        results = set()
        for _ in range(10):
            code_verifier, code_challenge = generate_pkce_challenge()
            results.add((code_verifier, code_challenge))

        # All should be unique
        assert len(results) == 10


class TestRedisStateManagement:
    """Test Redis state management functions."""

    @patch("core.mcp.auth.auth_flow.redis_client")
    def test_create_secure_redis_state(self, mock_redis):
        """Test creating secure Redis state."""
        state_data = OAuthCallbackState(
            provider_id="test-provider",
            tenant_id="test-tenant",
            server_url="https://example.com",
            metadata=None,
            client_information=OAuthClientInformation(client_id="test-client"),
            code_verifier="test-verifier",
            redirect_uri="https://redirect.example.com",
        )

        state_key = _create_secure_redis_state(state_data)

        # Verify state key format
        assert len(state_key) > 20  # Should be a secure random token

        # Verify Redis call
        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args
        assert call_args[0][0].startswith(OAUTH_STATE_REDIS_KEY_PREFIX)
        assert call_args[0][1] == OAUTH_STATE_EXPIRY_SECONDS
        assert state_data.model_dump_json() in call_args[0][2]

    @patch("core.mcp.auth.auth_flow.redis_client")
    def test_retrieve_redis_state_success(self, mock_redis):
        """Test retrieving state from Redis."""
        state_data = OAuthCallbackState(
            provider_id="test-provider",
            tenant_id="test-tenant",
            server_url="https://example.com",
            metadata=None,
            client_information=OAuthClientInformation(client_id="test-client"),
            code_verifier="test-verifier",
            redirect_uri="https://redirect.example.com",
        )
        mock_redis.get.return_value = state_data.model_dump_json()

        result = _retrieve_redis_state("test-state-key")

        # Verify result
        assert result.provider_id == "test-provider"
        assert result.tenant_id == "test-tenant"
        assert result.server_url == "https://example.com"

        # Verify Redis calls
        mock_redis.get.assert_called_once_with(f"{OAUTH_STATE_REDIS_KEY_PREFIX}test-state-key")
        mock_redis.delete.assert_called_once_with(f"{OAUTH_STATE_REDIS_KEY_PREFIX}test-state-key")

    @patch("core.mcp.auth.auth_flow.redis_client")
    def test_retrieve_redis_state_not_found(self, mock_redis):
        """Test retrieving non-existent state from Redis."""
        mock_redis.get.return_value = None

        with pytest.raises(ValueError) as exc_info:
            _retrieve_redis_state("nonexistent-key")

        assert "State parameter has expired or does not exist" in str(exc_info.value)

    @patch("core.mcp.auth.auth_flow.redis_client")
    def test_retrieve_redis_state_invalid_json(self, mock_redis):
        """Test retrieving invalid JSON state from Redis."""
        mock_redis.get.return_value = '{"invalid": json}'

        with pytest.raises(ValueError) as exc_info:
            _retrieve_redis_state("test-key")

        assert "Invalid state parameter" in str(exc_info.value)
        # State should still be deleted
        mock_redis.delete.assert_called_once()


class TestOAuthDiscovery:
    """Test OAuth discovery functions."""

    @patch("core.helper.ssrf_proxy.get")
    def test_check_support_resource_discovery_success(self, mock_get):
        """Test successful resource discovery check."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"authorization_server_url": ["https://auth.example.com"]}
        mock_get.return_value = mock_response

        supported, auth_url = check_support_resource_discovery("https://api.example.com/endpoint")

        assert supported is True
        assert auth_url == "https://auth.example.com"
        mock_get.assert_called_once_with(
            "https://api.example.com/.well-known/oauth-protected-resource",
            headers={"MCP-Protocol-Version": "2025-03-26", "User-Agent": "Dify"},
        )

    @patch("core.helper.ssrf_proxy.get")
    def test_check_support_resource_discovery_not_supported(self, mock_get):
        """Test resource discovery not supported."""
        mock_response = Mock()
        mock_response.status_code = 404
        mock_get.return_value = mock_response

        supported, auth_url = check_support_resource_discovery("https://api.example.com")

        assert supported is False
        assert auth_url == ""

    @patch("core.helper.ssrf_proxy.get")
    def test_check_support_resource_discovery_with_query_fragment(self, mock_get):
        """Test resource discovery with query and fragment."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"authorization_server_url": ["https://auth.example.com"]}
        mock_get.return_value = mock_response

        supported, auth_url = check_support_resource_discovery("https://api.example.com/path?query=1#fragment")

        assert supported is True
        assert auth_url == "https://auth.example.com"
        mock_get.assert_called_once_with(
            "https://api.example.com/.well-known/oauth-protected-resource?query=1#fragment",
            headers={"MCP-Protocol-Version": "2025-03-26", "User-Agent": "Dify"},
        )

    @patch("core.helper.ssrf_proxy.get")
    def test_discover_oauth_metadata_with_resource_discovery(self, mock_get):
        """Test OAuth metadata discovery with resource discovery support."""
        with patch("core.mcp.auth.auth_flow.check_support_resource_discovery") as mock_check:
            mock_check.return_value = (True, "https://auth.example.com")

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.is_success = True
            mock_response.json.return_value = {
                "authorization_endpoint": "https://auth.example.com/authorize",
                "token_endpoint": "https://auth.example.com/token",
                "response_types_supported": ["code"],
            }
            mock_get.return_value = mock_response

            metadata = discover_oauth_metadata("https://api.example.com")

            assert metadata is not None
            assert metadata.authorization_endpoint == "https://auth.example.com/authorize"
            assert metadata.token_endpoint == "https://auth.example.com/token"
            mock_get.assert_called_once_with(
                "https://auth.example.com/.well-known/oauth-authorization-server",
                headers={"MCP-Protocol-Version": "2025-03-26"},
            )

    @patch("core.helper.ssrf_proxy.get")
    def test_discover_oauth_metadata_without_resource_discovery(self, mock_get):
        """Test OAuth metadata discovery without resource discovery."""
        with patch("core.mcp.auth.auth_flow.check_support_resource_discovery") as mock_check:
            mock_check.return_value = (False, "")

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.is_success = True
            mock_response.json.return_value = {
                "authorization_endpoint": "https://api.example.com/oauth/authorize",
                "token_endpoint": "https://api.example.com/oauth/token",
                "response_types_supported": ["code"],
            }
            mock_get.return_value = mock_response

            metadata = discover_oauth_metadata("https://api.example.com")

            assert metadata is not None
            assert metadata.authorization_endpoint == "https://api.example.com/oauth/authorize"
            mock_get.assert_called_once_with(
                "https://api.example.com/.well-known/oauth-authorization-server",
                headers={"MCP-Protocol-Version": "2025-03-26"},
            )

    @patch("core.helper.ssrf_proxy.get")
    def test_discover_oauth_metadata_not_found(self, mock_get):
        """Test OAuth metadata discovery when not found."""
        with patch("core.mcp.auth.auth_flow.check_support_resource_discovery") as mock_check:
            mock_check.return_value = (False, "")

            mock_response = Mock()
            mock_response.status_code = 404
            mock_get.return_value = mock_response

            metadata = discover_oauth_metadata("https://api.example.com")

            assert metadata is None


class TestAuthorizationFlow:
    """Test authorization flow functions."""

    @patch("core.mcp.auth.auth_flow._create_secure_redis_state")
    def test_start_authorization_with_metadata(self, mock_create_state):
        """Test starting authorization with metadata."""
        mock_create_state.return_value = "secure-state-key"

        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            code_challenge_methods_supported=["S256"],
        )
        client_info = OAuthClientInformation(client_id="test-client-id")

        auth_url, code_verifier = start_authorization(
            "https://api.example.com",
            metadata,
            client_info,
            "https://redirect.example.com",
            "provider-id",
            "tenant-id",
        )

        # Verify URL format
        assert auth_url.startswith("https://auth.example.com/authorize?")
        assert "response_type=code" in auth_url
        assert "client_id=test-client-id" in auth_url
        assert "code_challenge=" in auth_url
        assert "code_challenge_method=S256" in auth_url
        assert "redirect_uri=https%3A%2F%2Fredirect.example.com" in auth_url
        assert "state=secure-state-key" in auth_url

        # Verify code verifier
        assert len(code_verifier) > 40

        # Verify state was stored
        mock_create_state.assert_called_once()
        state_data = mock_create_state.call_args[0][0]
        assert state_data.provider_id == "provider-id"
        assert state_data.tenant_id == "tenant-id"
        assert state_data.code_verifier == code_verifier

    def test_start_authorization_without_metadata(self):
        """Test starting authorization without metadata."""
        with patch("core.mcp.auth.auth_flow._create_secure_redis_state") as mock_create_state:
            mock_create_state.return_value = "secure-state-key"

            client_info = OAuthClientInformation(client_id="test-client-id")

            auth_url, code_verifier = start_authorization(
                "https://api.example.com",
                None,
                client_info,
                "https://redirect.example.com",
                "provider-id",
                "tenant-id",
            )

            # Should use default authorization endpoint
            assert auth_url.startswith("https://api.example.com/authorize?")

    def test_start_authorization_invalid_metadata(self):
        """Test starting authorization with invalid metadata."""
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["token"],  # No "code" support
            code_challenge_methods_supported=["plain"],  # No "S256" support
        )
        client_info = OAuthClientInformation(client_id="test-client-id")

        with pytest.raises(ValueError) as exc_info:
            start_authorization(
                "https://api.example.com",
                metadata,
                client_info,
                "https://redirect.example.com",
                "provider-id",
                "tenant-id",
            )

        assert "does not support response type code" in str(exc_info.value)

    @patch("core.helper.ssrf_proxy.post")
    def test_exchange_authorization_success(self, mock_post):
        """Test successful authorization code exchange."""
        mock_response = Mock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "access_token": "new-access-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": "new-refresh-token",
        }
        mock_post.return_value = mock_response

        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )
        client_info = OAuthClientInformation(client_id="test-client-id", client_secret="test-secret")

        tokens = exchange_authorization(
            "https://api.example.com",
            metadata,
            client_info,
            "auth-code-123",
            "code-verifier-xyz",
            "https://redirect.example.com",
        )

        assert tokens.access_token == "new-access-token"
        assert tokens.token_type == "Bearer"
        assert tokens.expires_in == 3600
        assert tokens.refresh_token == "new-refresh-token"

        # Verify request
        mock_post.assert_called_once_with(
            "https://auth.example.com/token",
            data={
                "grant_type": "authorization_code",
                "client_id": "test-client-id",
                "client_secret": "test-secret",
                "code": "auth-code-123",
                "code_verifier": "code-verifier-xyz",
                "redirect_uri": "https://redirect.example.com",
            },
        )

    @patch("core.helper.ssrf_proxy.post")
    def test_exchange_authorization_failure(self, mock_post):
        """Test failed authorization code exchange."""
        mock_response = Mock()
        mock_response.is_success = False
        mock_response.status_code = 400
        mock_post.return_value = mock_response

        client_info = OAuthClientInformation(client_id="test-client-id")

        with pytest.raises(ValueError) as exc_info:
            exchange_authorization(
                "https://api.example.com",
                None,
                client_info,
                "invalid-code",
                "code-verifier",
                "https://redirect.example.com",
            )

        assert "Token exchange failed: HTTP 400" in str(exc_info.value)

    @patch("core.helper.ssrf_proxy.post")
    def test_refresh_authorization_success(self, mock_post):
        """Test successful token refresh."""
        mock_response = Mock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "access_token": "refreshed-access-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": "new-refresh-token",
        }
        mock_post.return_value = mock_response

        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            grant_types_supported=["refresh_token"],
        )
        client_info = OAuthClientInformation(client_id="test-client-id")

        tokens = refresh_authorization("https://api.example.com", metadata, client_info, "old-refresh-token")

        assert tokens.access_token == "refreshed-access-token"
        assert tokens.refresh_token == "new-refresh-token"

        # Verify request
        mock_post.assert_called_once_with(
            "https://auth.example.com/token",
            data={
                "grant_type": "refresh_token",
                "client_id": "test-client-id",
                "refresh_token": "old-refresh-token",
            },
        )

    @patch("core.helper.ssrf_proxy.post")
    def test_register_client_success(self, mock_post):
        """Test successful client registration."""
        mock_response = Mock()
        mock_response.is_success = True
        mock_response.json.return_value = {
            "client_id": "new-client-id",
            "client_secret": "new-client-secret",
            "client_name": "Dify",
            "redirect_uris": ["https://redirect.example.com"],
        }
        mock_post.return_value = mock_response

        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint="https://auth.example.com/register",
            response_types_supported=["code"],
        )
        client_metadata = OAuthClientMetadata(
            client_name="Dify",
            redirect_uris=["https://redirect.example.com"],
            grant_types=["authorization_code"],
            response_types=["code"],
        )

        client_info = register_client("https://api.example.com", metadata, client_metadata)

        assert isinstance(client_info, OAuthClientInformationFull)
        assert client_info.client_id == "new-client-id"
        assert client_info.client_secret == "new-client-secret"

        # Verify request
        mock_post.assert_called_once_with(
            "https://auth.example.com/register",
            json=client_metadata.model_dump(),
            headers={"Content-Type": "application/json"},
        )

    def test_register_client_no_endpoint(self):
        """Test client registration when no endpoint available."""
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint=None,
            response_types_supported=["code"],
        )
        client_metadata = OAuthClientMetadata(client_name="Dify", redirect_uris=["https://redirect.example.com"])

        with pytest.raises(ValueError) as exc_info:
            register_client("https://api.example.com", metadata, client_metadata)

        assert "does not support dynamic client registration" in str(exc_info.value)


class TestCallbackHandling:
    """Test OAuth callback handling."""

    @patch("core.mcp.auth.auth_flow._retrieve_redis_state")
    @patch("core.mcp.auth.auth_flow.exchange_authorization")
    def test_handle_callback_success(self, mock_exchange, mock_retrieve_state):
        """Test successful callback handling."""
        # Setup state
        state_data = OAuthCallbackState(
            provider_id="test-provider",
            tenant_id="test-tenant",
            server_url="https://api.example.com",
            metadata=None,
            client_information=OAuthClientInformation(client_id="test-client"),
            code_verifier="test-verifier",
            redirect_uri="https://redirect.example.com",
        )
        mock_retrieve_state.return_value = state_data

        # Setup token exchange
        tokens = OAuthTokens(
            access_token="new-token",
            token_type="Bearer",
            expires_in=3600,
        )
        mock_exchange.return_value = tokens

        # Setup service
        mock_service = Mock()

        state_result, tokens_result = handle_callback("state-key", "auth-code")

        assert state_result == state_data
        assert tokens_result == tokens

        # Verify calls
        mock_retrieve_state.assert_called_once_with("state-key")
        mock_exchange.assert_called_once_with(
            "https://api.example.com",
            None,
            state_data.client_information,
            "auth-code",
            "test-verifier",
            "https://redirect.example.com",
        )
        # Note: handle_callback no longer saves tokens directly, it just returns them
        # The caller (e.g., controller) is responsible for saving via execute_auth_actions


class TestAuthOrchestration:
    """Test the main auth orchestration function."""

    @pytest.fixture
    def mock_provider(self):
        """Create a mock provider entity."""
        provider = Mock(spec=MCPProviderEntity)
        provider.id = "provider-id"
        provider.tenant_id = "tenant-id"
        provider.decrypt_server_url.return_value = "https://api.example.com"
        provider.client_metadata = OAuthClientMetadata(
            client_name="Dify",
            redirect_uris=["https://redirect.example.com"],
        )
        provider.redirect_url = "https://redirect.example.com"
        provider.retrieve_client_information.return_value = None
        provider.retrieve_tokens.return_value = None
        return provider

    @pytest.fixture
    def mock_service(self):
        """Create a mock MCP service."""
        return Mock()

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    @patch("core.mcp.auth.auth_flow.register_client")
    @patch("core.mcp.auth.auth_flow.start_authorization")
    def test_auth_new_registration(self, mock_start_auth, mock_register, mock_discover, mock_provider, mock_service):
        """Test auth flow for new client registration."""
        # Setup
        mock_discover.return_value = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )
        mock_register.return_value = OAuthClientInformationFull(
            client_id="new-client-id",
            client_name="Dify",
            redirect_uris=["https://redirect.example.com"],
        )
        mock_start_auth.return_value = ("https://auth.example.com/authorize?...", "code-verifier")

        result = auth(mock_provider)

        # auth() now returns AuthResult
        assert isinstance(result, AuthResult)
        assert result.response == {"authorization_url": "https://auth.example.com/authorize?..."}

        # Verify that the result contains the correct actions
        assert len(result.actions) == 2
        # Check for SAVE_CLIENT_INFO action
        client_info_action = next(a for a in result.actions if a.action_type == AuthActionType.SAVE_CLIENT_INFO)
        assert client_info_action.data == {"client_information": mock_register.return_value.model_dump()}
        assert client_info_action.provider_id == "provider-id"
        assert client_info_action.tenant_id == "tenant-id"

        # Check for SAVE_CODE_VERIFIER action
        verifier_action = next(a for a in result.actions if a.action_type == AuthActionType.SAVE_CODE_VERIFIER)
        assert verifier_action.data == {"code_verifier": "code-verifier"}
        assert verifier_action.provider_id == "provider-id"
        assert verifier_action.tenant_id == "tenant-id"

        # Verify calls
        mock_register.assert_called_once()

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    @patch("core.mcp.auth.auth_flow._retrieve_redis_state")
    @patch("core.mcp.auth.auth_flow.exchange_authorization")
    def test_auth_exchange_code(self, mock_exchange, mock_retrieve_state, mock_discover, mock_provider, mock_service):
        """Test auth flow for exchanging authorization code."""
        # Setup metadata discovery
        mock_discover.return_value = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )

        # Setup existing client
        mock_provider.retrieve_client_information.return_value = OAuthClientInformation(client_id="existing-client")

        # Setup state retrieval
        state_data = OAuthCallbackState(
            provider_id="provider-id",
            tenant_id="tenant-id",
            server_url="https://api.example.com",
            metadata=None,
            client_information=OAuthClientInformation(client_id="existing-client"),
            code_verifier="test-verifier",
            redirect_uri="https://redirect.example.com",
        )
        mock_retrieve_state.return_value = state_data

        # Setup token exchange
        tokens = OAuthTokens(access_token="new-token", token_type="Bearer", expires_in=3600)
        mock_exchange.return_value = tokens

        result = auth(mock_provider, authorization_code="auth-code", state_param="state-key")

        # auth() now returns AuthResult, not a dict
        assert isinstance(result, AuthResult)
        assert result.response == {"result": "success"}

        # Verify that the result contains the correct action
        assert len(result.actions) == 1
        assert result.actions[0].action_type == AuthActionType.SAVE_TOKENS
        assert result.actions[0].data == tokens.model_dump()
        assert result.actions[0].provider_id == "provider-id"
        assert result.actions[0].tenant_id == "tenant-id"

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    def test_auth_exchange_code_without_state(self, mock_discover, mock_provider, mock_service):
        """Test auth flow fails when exchanging code without state."""
        # Setup metadata discovery
        mock_discover.return_value = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )

        mock_provider.retrieve_client_information.return_value = OAuthClientInformation(client_id="existing-client")

        with pytest.raises(ValueError) as exc_info:
            auth(mock_provider, authorization_code="auth-code")

        assert "State parameter is required" in str(exc_info.value)

    @patch("core.mcp.auth.auth_flow.refresh_authorization")
    def test_auth_refresh_token(self, mock_refresh, mock_provider, mock_service):
        """Test auth flow for refreshing tokens."""
        # Setup existing client and tokens
        mock_provider.retrieve_client_information.return_value = OAuthClientInformation(client_id="existing-client")
        mock_provider.retrieve_tokens.return_value = OAuthTokens(
            access_token="old-token",
            token_type="Bearer",
            expires_in=0,
            refresh_token="refresh-token",
        )

        # Setup refresh
        new_tokens = OAuthTokens(
            access_token="refreshed-token",
            token_type="Bearer",
            expires_in=3600,
            refresh_token="new-refresh-token",
        )
        mock_refresh.return_value = new_tokens

        with patch("core.mcp.auth.auth_flow.discover_oauth_metadata") as mock_discover:
            mock_discover.return_value = OAuthMetadata(
                authorization_endpoint="https://auth.example.com/authorize",
                token_endpoint="https://auth.example.com/token",
                response_types_supported=["code"],
                grant_types_supported=["authorization_code"],
            )

            result = auth(mock_provider)

            # auth() now returns AuthResult
            assert isinstance(result, AuthResult)
            assert result.response == {"result": "success"}

            # Verify that the result contains the correct action
            assert len(result.actions) == 1
            assert result.actions[0].action_type == AuthActionType.SAVE_TOKENS
            assert result.actions[0].data == new_tokens.model_dump()
            assert result.actions[0].provider_id == "provider-id"
            assert result.actions[0].tenant_id == "tenant-id"

            # Verify refresh was called
            mock_refresh.assert_called_once()

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    def test_auth_registration_fails_with_code(self, mock_discover, mock_provider, mock_service):
        """Test auth fails when no client info exists but code is provided."""
        # Setup metadata discovery
        mock_discover.return_value = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )

        mock_provider.retrieve_client_information.return_value = None

        with pytest.raises(ValueError) as exc_info:
            auth(mock_provider, authorization_code="auth-code")

        assert "Existing OAuth client information is required" in str(exc_info.value)
