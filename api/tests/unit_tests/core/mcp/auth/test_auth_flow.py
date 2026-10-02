"""Unit tests for MCP OAuth authentication flow."""

from unittest.mock import patch

import httpx
import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.helper import ssrf_proxy
from core.mcp.auth.auth_flow import (
    OAUTH_STATE_EXPIRY_SECONDS,
    OAUTH_STATE_REDIS_KEY_PREFIX,
    OAuthCallbackState,
    _create_secure_redis_state,
    _parse_token_response,
    _retrieve_redis_state,
    auth,
    build_oauth_authorization_server_metadata_discovery_urls,
    build_protected_resource_metadata_discovery_urls,
    check_support_resource_discovery,
    client_credentials_flow,
    discover_oauth_authorization_server_metadata,
    discover_oauth_metadata,
    discover_protected_resource_metadata,
    exchange_authorization,
    generate_pkce_challenge,
    get_effective_scope,
    handle_callback,
    refresh_authorization,
    register_client,
    start_authorization,
)
from core.mcp.entities import AuthActionType, AuthResult
from core.mcp.error import MCPRefreshTokenError
from core.mcp.types import (
    LATEST_PROTOCOL_VERSION,
    OAuthClientInformation,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthTokens,
    ProtectedResourceMetadata,
)
from tests.unit_tests.core.mcp.fixtures import make_provider


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> MCPProviderEntity:
    """Use real credential parsing with plaintext values at the decryption boundary."""
    monkeypatch.setattr("core.entities.mcp_provider.encrypter.decrypt_token", lambda _tenant_id, token: token)
    monkeypatch.setattr(MCPProviderEntity, "_decrypt_dict", lambda _self, data: data.copy())
    return make_provider(credentials={})


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
        mock_response = httpx.Response(200, json={"authorization_server_url": ["https://auth.example.com"]})
        mock_get.return_value = mock_response

        supported, auth_url = check_support_resource_discovery("https://api.example.com/endpoint")

        assert supported is True
        assert auth_url == "https://auth.example.com"
        mock_get.assert_called_once_with(
            "https://api.example.com/.well-known/oauth-protected-resource",
            headers={"MCP-Protocol-Version": LATEST_PROTOCOL_VERSION, "User-Agent": "Dify"},
        )

    @patch("core.helper.ssrf_proxy.get")
    def test_check_support_resource_discovery_not_supported(self, mock_get):
        """Test resource discovery not supported."""
        mock_response = httpx.Response(404)
        mock_get.return_value = mock_response

        supported, auth_url = check_support_resource_discovery("https://api.example.com")

        assert supported is False
        assert auth_url == ""

    @patch("core.helper.ssrf_proxy.get")
    def test_check_support_resource_discovery_with_query_fragment(self, mock_get):
        """Test resource discovery with query and fragment."""
        mock_response = httpx.Response(200, json={"authorization_server_url": ["https://auth.example.com"]})
        mock_get.return_value = mock_response

        supported, auth_url = check_support_resource_discovery("https://api.example.com/path?query=1#fragment")

        assert supported is True
        assert auth_url == "https://auth.example.com"
        mock_get.assert_called_once_with(
            "https://api.example.com/.well-known/oauth-protected-resource?query=1#fragment",
            headers={"MCP-Protocol-Version": LATEST_PROTOCOL_VERSION, "User-Agent": "Dify"},
        )

    def test_discover_oauth_metadata_with_resource_discovery(self):
        """Test OAuth metadata discovery with resource discovery support."""
        with patch("core.mcp.auth.auth_flow.discover_protected_resource_metadata") as mock_prm:
            with patch("core.mcp.auth.auth_flow.discover_oauth_authorization_server_metadata") as mock_asm:
                # Mock protected resource metadata with auth server URL
                mock_prm.return_value = ProtectedResourceMetadata(
                    resource="https://api.example.com",
                    authorization_servers=["https://auth.example.com"],
                )

                # Mock OAuth authorization server metadata
                mock_asm.return_value = OAuthMetadata(
                    authorization_endpoint="https://auth.example.com/authorize",
                    token_endpoint="https://auth.example.com/token",
                    response_types_supported=["code"],
                )

                oauth_metadata, prm, scope = discover_oauth_metadata("https://api.example.com")

                assert oauth_metadata is not None
                assert oauth_metadata.authorization_endpoint == "https://auth.example.com/authorize"
                assert oauth_metadata.token_endpoint == "https://auth.example.com/token"
                assert prm is not None
                assert prm.authorization_servers == ["https://auth.example.com"]

                # Verify the discovery functions were called
                mock_prm.assert_called_once()
                mock_asm.assert_called_once()

    def test_discover_oauth_metadata_without_resource_discovery(self):
        """Test OAuth metadata discovery without resource discovery."""
        with patch("core.mcp.auth.auth_flow.discover_protected_resource_metadata") as mock_prm:
            with patch("core.mcp.auth.auth_flow.discover_oauth_authorization_server_metadata") as mock_asm:
                # Mock no protected resource metadata
                mock_prm.return_value = None

                # Mock OAuth authorization server metadata
                mock_asm.return_value = OAuthMetadata(
                    authorization_endpoint="https://api.example.com/oauth/authorize",
                    token_endpoint="https://api.example.com/oauth/token",
                    response_types_supported=["code"],
                )

                oauth_metadata, prm, scope = discover_oauth_metadata("https://api.example.com")

                assert oauth_metadata is not None
                assert oauth_metadata.authorization_endpoint == "https://api.example.com/oauth/authorize"
                assert prm is None

                # Verify the discovery functions were called
                mock_prm.assert_called_once()
                mock_asm.assert_called_once()

    @patch("core.helper.ssrf_proxy.get")
    def test_discover_oauth_metadata_not_found(self, mock_get):
        """Test OAuth metadata discovery when not found."""
        with patch("core.mcp.auth.auth_flow.check_support_resource_discovery") as mock_check:
            mock_check.return_value = (False, "")

            mock_response = httpx.Response(404)
            mock_get.return_value = mock_response

            oauth_metadata, prm, scope = discover_oauth_metadata("https://api.example.com")

            assert oauth_metadata is None


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
        mock_response = httpx.Response(
            200,
            json={
                "access_token": "new-access-token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "refresh_token": "new-refresh-token",
            },
            headers={"content-type": "application/json"},
        )
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
        mock_response = httpx.Response(400)
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
        mock_response = httpx.Response(
            200,
            json={
                "access_token": "refreshed-access-token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "refresh_token": "new-refresh-token",
            },
            headers={"content-type": "application/json"},
        )
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
        mock_response = httpx.Response(
            200,
            json={
                "client_id": "new-client-id",
                "client_secret": "new-client-secret",
                "client_name": "Dify",
                "redirect_uris": ["https://redirect.example.com"],
            },
        )
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

    @patch("core.helper.ssrf_proxy.post")
    def test_register_client_rejected_by_server(self, mock_post):
        """A rejected dynamic registration must raise ValueError, not httpx.HTTPStatusError.

        `auth()` lets anything that is not a RequestError propagate, and the
        console MCP auth endpoint only turns MCPError/ValueError into a 4xx, so
        a raw HTTPStatusError here surfaces as an opaque 500.
        """
        mock_response = httpx.Response(
            400,
            text='{"error":"invalid_redirect_uri"}',
            request=httpx.Request("POST", "https://auth.example.com/register"),
        )
        mock_post.return_value = mock_response

        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint="https://auth.example.com/register",
            response_types_supported=["code"],
        )
        client_metadata = OAuthClientMetadata(client_name="Dify", redirect_uris=["https://redirect.example.com"])

        with pytest.raises(ValueError) as exc_info:
            register_client("https://api.example.com", metadata, client_metadata)

        message = str(exc_info.value)
        assert "400" in message
        assert "invalid_redirect_uri" in message

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

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    @patch("core.mcp.auth.auth_flow.register_client")
    @patch("core.mcp.auth.auth_flow.start_authorization")
    def test_auth_new_registration(self, mock_start_auth, mock_register, mock_discover, provider):
        """Test auth flow for new client registration."""
        # Setup
        mock_discover.return_value = (
            OAuthMetadata(
                authorization_endpoint="https://auth.example.com/authorize",
                token_endpoint="https://auth.example.com/token",
                response_types_supported=["code"],
                grant_types_supported=["authorization_code"],
            ),
            None,
            None,
        )
        mock_register.return_value = OAuthClientInformationFull(
            client_id="new-client-id",
            client_name="Dify",
            redirect_uris=["https://redirect.example.com"],
        )
        mock_start_auth.return_value = ("https://auth.example.com/authorize?...", "code-verifier")

        result = auth(provider)

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
    def test_auth_exchange_code(self, mock_exchange, mock_retrieve_state, mock_discover, provider):
        """Test auth flow for exchanging authorization code."""
        # Setup metadata discovery
        mock_discover.return_value = (
            OAuthMetadata(
                authorization_endpoint="https://auth.example.com/authorize",
                token_endpoint="https://auth.example.com/token",
                response_types_supported=["code"],
                grant_types_supported=["authorization_code"],
            ),
            None,
            None,
        )

        # Setup existing client
        provider.credentials["client_information"] = {"client_id": "existing-client"}

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

        result = auth(provider, authorization_code="auth-code", state_param="state-key")

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
    def test_auth_exchange_code_without_state(self, mock_discover, provider):
        """Test auth flow fails when exchanging code without state."""
        # Setup metadata discovery
        mock_discover.return_value = (
            OAuthMetadata(
                authorization_endpoint="https://auth.example.com/authorize",
                token_endpoint="https://auth.example.com/token",
                response_types_supported=["code"],
                grant_types_supported=["authorization_code"],
            ),
            None,
            None,
        )

        provider.credentials["client_information"] = {"client_id": "existing-client"}

        with pytest.raises(ValueError) as exc_info:
            auth(provider, authorization_code="auth-code")

        assert "State parameter is required" in str(exc_info.value)

    @patch("core.mcp.auth.auth_flow.refresh_authorization")
    def test_auth_refresh_token(self, mock_refresh, provider):
        """Test auth flow for refreshing tokens."""
        # Setup existing client and tokens
        provider.credentials["client_information"] = {"client_id": "existing-client"}
        provider.credentials.update(
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
            mock_discover.return_value = (
                OAuthMetadata(
                    authorization_endpoint="https://auth.example.com/authorize",
                    token_endpoint="https://auth.example.com/token",
                    response_types_supported=["code"],
                    grant_types_supported=["authorization_code"],
                ),
                None,
                None,
            )

            result = auth(provider)

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
    def test_auth_registration_fails_with_code(self, mock_discover, provider):
        """Test auth fails when no client info exists but code is provided."""
        # Setup metadata discovery
        mock_discover.return_value = (
            OAuthMetadata(
                authorization_endpoint="https://auth.example.com/authorize",
                token_endpoint="https://auth.example.com/token",
                response_types_supported=["code"],
                grant_types_supported=["authorization_code"],
            ),
            None,
            None,
        )

        provider.credentials.pop("client_information", None)

        with pytest.raises(ValueError) as exc_info:
            auth(provider, authorization_code="auth-code")

        assert "Existing OAuth client information is required" in str(exc_info.value)

    def test_generate_pkce_challenge(self):
        verifier, challenge = generate_pkce_challenge()
        assert verifier
        assert challenge
        assert "=" not in verifier
        assert "=" not in challenge

    def test_build_protected_resource_metadata_discovery_urls(self):
        # Case 1: WWW-Auth URL provided
        urls = build_protected_resource_metadata_discovery_urls(
            "https://auth.example.com/prm", "https://api.example.com"
        )
        assert "https://auth.example.com/prm" in urls
        assert "https://api.example.com/.well-known/oauth-protected-resource" in urls

        # Case 2: No WWW-Auth URL, with path
        urls = build_protected_resource_metadata_discovery_urls(None, "https://api.example.com/v1")
        assert "https://api.example.com/.well-known/oauth-protected-resource/v1" in urls
        assert "https://api.example.com/.well-known/oauth-protected-resource" in urls

        # Case 3: No path
        urls = build_protected_resource_metadata_discovery_urls(None, "https://api.example.com")
        assert urls == ["https://api.example.com/.well-known/oauth-protected-resource"]

    def test_build_protected_resource_metadata_discovery_urls_with_relative_hint(self):
        urls = build_protected_resource_metadata_discovery_urls(
            "/.well-known/oauth-protected-resource/tenant/mcp",
            "https://api.example.com/tenant/mcp",
        )
        assert urls == [
            "https://api.example.com/.well-known/oauth-protected-resource/tenant/mcp",
            "https://api.example.com/.well-known/oauth-protected-resource",
        ]

    def test_build_protected_resource_metadata_discovery_urls_ignores_scheme_less_hint(self):
        urls = build_protected_resource_metadata_discovery_urls(
            "/openapi-mcp.cn-hangzhou.aliyuncs.com/.well-known/oauth-protected-resource/tenant/mcp",
            "https://openapi-mcp.cn-hangzhou.aliyuncs.com/tenant/mcp",
        )

        assert urls == [
            "https://openapi-mcp.cn-hangzhou.aliyuncs.com/.well-known/oauth-protected-resource/tenant/mcp",
            "https://openapi-mcp.cn-hangzhou.aliyuncs.com/.well-known/oauth-protected-resource",
        ]

    def test_build_oauth_authorization_server_metadata_discovery_urls(self):
        # Case 1: with auth_server_url
        urls = build_oauth_authorization_server_metadata_discovery_urls(
            "https://auth.example.com", "https://api.example.com"
        )
        assert "https://auth.example.com/.well-known/oauth-authorization-server" in urls
        assert "https://auth.example.com/.well-known/openid-configuration" in urls

        # Case 2: with path
        urls = build_oauth_authorization_server_metadata_discovery_urls(None, "https://api.example.com/tenant")
        assert "https://api.example.com/.well-known/oauth-authorization-server/tenant" in urls
        assert "https://api.example.com/tenant/.well-known/openid-configuration" in urls

    @patch("core.helper.ssrf_proxy.get")
    def test_discover_protected_resource_metadata(self, mock_get):
        # Success
        mock_response = httpx.Response(
            200,
            json={
                "resource": "https://api.example.com",
                "authorization_servers": ["https://auth"],
            },
        )
        mock_get.return_value = mock_response
        result = discover_protected_resource_metadata(None, "https://api.example.com")
        assert result is not None
        assert result.resource == "https://api.example.com"

        # 404 then Success
        res404 = httpx.Response(404)
        mock_get.side_effect = [res404, mock_response]
        result = discover_protected_resource_metadata(None, "https://api.example.com/path")
        assert result is not None
        assert result.resource == "https://api.example.com"

        # Error handling
        mock_get.side_effect = httpx.RequestError("Error")
        result = discover_protected_resource_metadata(None, "https://api.example.com")
        assert result is None

        # JSONDecodeError (non-JSON 200 response)
        mock_get.side_effect = None
        bad_json_response = httpx.Response(200, content=b"not JSON")
        mock_get.return_value = bad_json_response
        result = discover_protected_resource_metadata(None, "https://api.example.com")
        assert result is None

    @patch("core.helper.ssrf_proxy.get")
    def test_discover_oauth_authorization_server_metadata(self, mock_get):
        # Success
        mock_response = httpx.Response(
            200,
            json={
                "authorization_endpoint": "https://auth.example.com/auth",
                "token_endpoint": "https://auth.example.com/token",
                "response_types_supported": ["code"],
            },
        )
        mock_get.return_value = mock_response
        result = discover_oauth_authorization_server_metadata(None, "https://api.example.com")
        assert result is not None
        assert result.authorization_endpoint == "https://auth.example.com/auth"

        # 404
        res404 = httpx.Response(404)
        mock_get.side_effect = [res404, mock_response]
        result = discover_oauth_authorization_server_metadata(None, "https://api.example.com/tenant")
        assert result is not None
        assert result.authorization_endpoint == "https://auth.example.com/auth"

        # ValidationError
        mock_get.side_effect = None
        mock_get.return_value = httpx.Response(200, json={"invalid": "data"})
        result = discover_oauth_authorization_server_metadata(None, "https://api.example.com")
        assert result is None

        # JSONDecodeError (non-JSON 200 response)
        bad_json_response = httpx.Response(200, content=b"not JSON")
        mock_get.return_value = bad_json_response
        result = discover_oauth_authorization_server_metadata(None, "https://api.example.com")
        assert result is None

    def test_get_effective_scope(self):
        prm = ProtectedResourceMetadata(
            resource="https://api.example.com",
            authorization_servers=["https://auth"],
            scopes_supported=["read", "write"],
        )
        asm = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/auth",
            token_endpoint="https://auth.example.com/token",
            response_types_supported=["code"],
            scopes_supported=["openid", "profile"],
        )

        # 1. WWW-Auth priority
        assert get_effective_scope("scope1", prm, asm, "client") == "scope1"
        # 2. PRM priority
        assert get_effective_scope(None, prm, asm, "client") == "read write"
        # 3. ASM priority
        assert get_effective_scope(None, None, asm, "client") == "openid profile"
        # 4. Client configured
        assert get_effective_scope(None, None, None, "client") == "client"

    @patch("core.mcp.auth.auth_flow.redis_client")
    def test_redis_state_management(self, mock_redis):
        state_data = OAuthCallbackState(
            provider_id="p1",
            tenant_id="t1",
            server_url="https://api",
            metadata=None,
            client_information=OAuthClientInformation(client_id="c1"),
            code_verifier="cv",
            redirect_uri="https://re",
        )

        # Create
        state_key = _create_secure_redis_state(state_data)
        assert state_key
        mock_redis.setex.assert_called_once()

        # Retrieve Success
        mock_redis.get.return_value = state_data.model_dump_json()
        retrieved = _retrieve_redis_state(state_key)
        assert retrieved.provider_id == "p1"
        mock_redis.delete.assert_called_once()

        # Retrieve Failure - Not found
        mock_redis.get.return_value = None
        with pytest.raises(ValueError, match="expired or does not exist"):
            _retrieve_redis_state("absent")

        # Retrieve Failure - Invalid JSON
        mock_redis.get.return_value = "invalid"
        with pytest.raises(ValueError, match="Invalid state parameter"):
            _retrieve_redis_state("invalid")

    @patch("core.mcp.auth.auth_flow._retrieve_redis_state")
    @patch("core.mcp.auth.auth_flow.exchange_authorization")
    def test_handle_callback(self, mock_exchange, mock_retrieve):
        state = OAuthCallbackState(
            provider_id="provider-id",
            tenant_id="tenant-id",
            server_url="https://api",
            client_information=OAuthClientInformation(client_id="c1"),
            code_verifier="cv",
            redirect_uri="https://re",
        )
        mock_retrieve.return_value = state

        tokens = OAuthTokens(access_token="at", token_type="Bearer")
        mock_exchange.return_value = tokens

        s, t = handle_callback("key", "code")
        assert s == state
        assert t == tokens

    @patch("core.helper.ssrf_proxy.get")
    def test_check_support_resource_discovery(self, mock_get):
        # Case 1: authorization_servers (plural)
        res = httpx.Response(200, json={"authorization_servers": ["https://auth1"]})
        mock_get.return_value = res
        supported, url = check_support_resource_discovery("https://api")
        assert supported is True
        assert url == "https://auth1"

        # Case 2: authorization_server_url (singular alias)
        mock_get.return_value = httpx.Response(200, json={"authorization_server_url": ["https://auth2"]})
        supported, url = check_support_resource_discovery("https://api")
        assert supported is True
        assert url == "https://auth2"

        # Case 3: Missing fields
        mock_get.return_value = httpx.Response(200, json={"nothing": []})
        supported, url = check_support_resource_discovery("https://api")
        assert supported is False

        # Case 4: 404
        mock_get.return_value = httpx.Response(404)
        supported, url = check_support_resource_discovery("https://api")
        assert supported is False

        # Case 5: RequestError
        mock_get.side_effect = httpx.RequestError("Error")
        supported, url = check_support_resource_discovery("https://api")
        assert supported is False

        # Case 6: JSONDecodeError (non-JSON 200 response)
        mock_get.side_effect = None
        bad_json_res = httpx.Response(200, content=b"not JSON")
        mock_get.return_value = bad_json_res
        supported, url = check_support_resource_discovery("https://api")
        assert supported is False
        assert url == ""

        # Case 7: Empty authorization_servers array (IndexError)
        empty_res = httpx.Response(200, json={"authorization_servers": []})
        mock_get.return_value = empty_res
        supported, url = check_support_resource_discovery("https://api")
        assert supported is False

    def test_discover_oauth_metadata(self):
        with patch("core.mcp.auth.auth_flow.discover_protected_resource_metadata") as mock_prm:
            with patch("core.mcp.auth.auth_flow.discover_oauth_authorization_server_metadata") as mock_asm:
                mock_prm.return_value = ProtectedResourceMetadata(
                    resource="https://api", authorization_servers=["https://auth"]
                )
                mock_asm.return_value = OAuthMetadata(
                    authorization_endpoint="https://auth/authorize",
                    token_endpoint="https://auth/token",
                    response_types_supported=["code"],
                )

                asm, prm, hint = discover_oauth_metadata("https://api")
                assert asm == mock_asm.return_value
                assert prm == mock_prm.return_value
                mock_asm.assert_called_with("https://auth", "https://api", None)

    def test_start_authorization(self):
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth/authorize",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
        )
        client_info = OAuthClientInformation(client_id="c1")

        with patch("core.mcp.auth.auth_flow._create_secure_redis_state") as mock_create:
            mock_create.return_value = "state-key"

            # Success with scope
            url, verifier = start_authorization("https://api", metadata, client_info, "https://re", "p1", "t1", "read")
            assert "scope=read" in url
            assert "state=state-key" in url

            # Success without metadata
            url, verifier = start_authorization("https://api", None, client_info, "https://re", "p1", "t1")
            assert "https://api/authorize" in url

            # Failure: incompatible auth server
            metadata.response_types_supported = ["implicit"]
            with pytest.raises(ValueError, match="Incompatible auth server"):
                start_authorization("https://api", metadata, client_info, "https://re", "p1", "t1")

    def test_parse_token_response(self):
        # Case 1: JSON
        res = httpx.Response(200, json={"access_token": "at", "token_type": "Bearer"})
        tokens = _parse_token_response(res)
        assert tokens.access_token == "at"

        # Case 2: Form-urlencoded
        res = httpx.Response(
            200,
            headers={"content-type": "application/x-www-form-urlencoded"},
            content=b"access_token=at2&token_type=Bearer",
        )
        tokens = _parse_token_response(res)
        assert tokens.access_token == "at2"

        # Case 3: No content-type, but JSON
        res = httpx.Response(200, content=b'{"access_token":"at3","token_type":"Bearer"}')
        tokens = _parse_token_response(res)
        assert tokens.access_token == "at3"

        # Case 4: No content-type, not JSON, but Form
        res = httpx.Response(200, content=b"access_token=at4&token_type=Bearer")
        tokens = _parse_token_response(res)
        assert tokens.access_token == "at4"

        # Case 5: A JSON string fails token-object validation; its form fields
        # still let the fallback recover the token from the same response body.
        res = httpx.Response(200, content=b'"ignored&access_token=at5&token_type=Bearer&ignored"')
        tokens = _parse_token_response(res)
        assert tokens.access_token == "at5"

    @patch("core.helper.ssrf_proxy.post")
    def test_exchange_authorization(self, mock_post):
        client_info = OAuthClientInformation(client_id="c1", client_secret="s1")
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth/authorize",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )

        # Success
        res = httpx.Response(200, json={"access_token": "at", "token_type": "Bearer"})
        mock_post.return_value = res

        tokens = exchange_authorization("https://api", metadata, client_info, "code", "verifier", "https://re")
        assert tokens.access_token == "at"

        # Failure: Unsupported grant type
        metadata.grant_types_supported = ["client_credentials"]
        with pytest.raises(ValueError, match="Incompatible auth server"):
            exchange_authorization("https://api", metadata, client_info, "code", "verifier", "https://re")

        # Failure: HTTP error
        metadata.grant_types_supported = ["authorization_code"]
        mock_post.return_value = httpx.Response(400)
        with pytest.raises(ValueError, match="Token exchange failed"):
            exchange_authorization("https://api", metadata, client_info, "code", "verifier", "https://re")

    @patch("core.helper.ssrf_proxy.post")
    def test_refresh_authorization(self, mock_post):
        # Case 1: with client_secret
        client_info = OAuthClientInformation(client_id="c1", client_secret="s1")

        # Success
        res = httpx.Response(200, json={"access_token": "at_new", "token_type": "Bearer"})
        mock_post.return_value = res

        tokens = refresh_authorization("https://api", None, client_info, "rt")
        assert tokens.access_token == "at_new"
        assert mock_post.call_args[1]["data"]["client_secret"] == "s1"

        # Failure: MaxRetriesExceededError
        mock_post.side_effect = ssrf_proxy.MaxRetriesExceededError("Too many retries")
        with pytest.raises(MCPRefreshTokenError):
            refresh_authorization("https://api", None, client_info, "rt")

        # Failure: HTTP error
        mock_post.side_effect = None
        mock_post.return_value = httpx.Response(400, text="error_msg")
        with pytest.raises(MCPRefreshTokenError, match="error_msg"):
            refresh_authorization("https://api", None, client_info, "rt")

        # Failure: Incompatible metadata
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )
        with pytest.raises(ValueError, match="Incompatible auth server"):
            refresh_authorization("https://api", metadata, client_info, "rt")

    @patch("core.helper.ssrf_proxy.post")
    def test_client_credentials_flow(self, mock_post):
        client_info = OAuthClientInformation(client_id="c1", client_secret="s1")

        # Success with secret
        res = httpx.Response(200, json={"access_token": "at_cc", "token_type": "Bearer"})
        mock_post.return_value = res

        tokens = client_credentials_flow("https://api", None, client_info, "read")
        assert tokens.access_token == "at_cc"
        args, kwargs = mock_post.call_args
        assert "Authorization" in kwargs["headers"]

        # Success without secret
        client_info_no_secret = OAuthClientInformation(client_id="c2")
        tokens = client_credentials_flow("https://api", None, client_info_no_secret)
        args, kwargs = mock_post.call_args
        assert kwargs["data"]["client_id"] == "c2"

        # Failure: Incompatible metadata
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )
        with pytest.raises(ValueError, match="Incompatible auth server"):
            client_credentials_flow("https://api", metadata, client_info)

        # Failure: HTTP error
        mock_post.return_value = httpx.Response(401, text="Unauthorized")
        with pytest.raises(ValueError, match="Client credentials token request failed"):
            client_credentials_flow("https://api", None, client_info)

    @patch("core.helper.ssrf_proxy.post")
    def test_register_client(self, mock_post):
        # Case 1: Success with metadata
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            registration_endpoint="https://auth/register",
            response_types_supported=["code"],
        )
        client_metadata = OAuthClientMetadata(client_name="Dify", redirect_uris=["https://re"])

        res = httpx.Response(
            200,
            json={
                "client_id": "c_new",
                "client_secret": "s_new",
                "client_name": "Dify",
                "redirect_uris": ["https://re"],
            },
        )
        mock_post.return_value = res

        info = register_client("https://api", metadata, client_metadata)
        assert info.client_id == "c_new"

        # Case 2: Success without metadata
        info = register_client("https://api", None, client_metadata)
        assert mock_post.call_args[0][0] == "https://api/register"

        # Case 3: Metadata provided but no endpoint
        metadata.registration_endpoint = None
        with pytest.raises(ValueError, match="does not support dynamic client registration"):
            register_client("https://api", metadata, client_metadata)

        # Failure: HTTP. A rejected registration must be reported as a ValueError so
        # callers can turn it into a user-facing error instead of a bare 500.
        mock_post.return_value = httpx.Response(400, text='{"error":"invalid_redirect_uri"}')
        with pytest.raises(ValueError, match="Client registration failed: HTTP 400"):
            register_client("https://api", None, client_metadata)

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    def test_auth_orchestration_failures(self, mock_discover, provider):
        provider.server_url = "https://api"

        # Case 1: No server metadata
        mock_discover.return_value = (None, None, None)
        with pytest.raises(ValueError, match="Failed to discover OAuth metadata"):
            auth(provider)

        # Case 2: No client info, exchange code provided
        asm = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
        )
        mock_discover.return_value = (asm, None, None)
        provider.credentials.pop("client_information", None)
        with pytest.raises(ValueError, match="Existing OAuth client information is required"):
            auth(provider, authorization_code="code")

        # Case 3: CLIENT_CREDENTIALS but client must provide info
        asm.grant_types_supported = ["client_credentials"]
        with pytest.raises(ValueError, match="requires client_id and client_secret"):
            auth(provider)

        # Case 4: Client registration fails
        asm.grant_types_supported = ["authorization_code"]
        with patch("core.mcp.auth.auth_flow.register_client") as mock_reg:
            mock_reg.side_effect = httpx.RequestError("Reg failed")
            with pytest.raises(ValueError, match="Could not register OAuth client"):
                auth(provider)

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    def test_auth_orchestration_client_credentials(self, mock_discover, provider):
        provider.server_url = "https://api"
        provider.credentials = {"client_information": {"client_id": "c1", "client_secret": "s1"}, "scope": "read"}

        asm = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
            grant_types_supported=["client_credentials"],
        )
        mock_discover.return_value = (asm, None, None)

        with patch("core.mcp.auth.auth_flow.client_credentials_flow") as mock_cc:
            mock_cc.return_value = OAuthTokens(access_token="at_cc", token_type="Bearer")

            result = auth(provider)
            assert result.response == {"result": "success"}
            assert result.actions[0].action_type == AuthActionType.SAVE_TOKENS
            assert result.actions[0].data["grant_type"] == "client_credentials"

            # Failure in CC flow
            mock_cc.side_effect = ValueError("CC Failed")
            with pytest.raises(ValueError, match="Client credentials flow failed"):
                auth(provider)

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    def test_auth_orchestration_authorization_code(self, mock_discover, provider):
        provider.server_url = "https://api"
        provider.credentials = {"client_information": {"client_id": "c1"}}

        asm = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )
        mock_discover.return_value = (asm, None, None)

        # Case 1: Exchange code
        with patch("core.mcp.auth.auth_flow._retrieve_redis_state") as mock_retrieve:
            state = OAuthCallbackState(
                provider_id=provider.id,
                tenant_id=provider.tenant_id,
                server_url=provider.server_url,
                client_information=OAuthClientInformation(client_id="c1"),
                code_verifier="cv",
                redirect_uri="https://re",
            )
            mock_retrieve.return_value = state

            with patch("core.mcp.auth.auth_flow.exchange_authorization") as mock_exchange:
                mock_exchange.return_value = OAuthTokens(access_token="at_code", token_type="Bearer")

                # Success
                result = auth(provider, authorization_code="code", state_param="sp")
                assert result.response == {"result": "success"}

                # Missing state_param
                with pytest.raises(ValueError, match="State parameter is required"):
                    auth(provider, authorization_code="code")

                # Missing verifier in state
                state.code_verifier = ""
                with pytest.raises(ValueError, match="Missing code_verifier"):
                    auth(provider, authorization_code="code", state_param="sp")

                # Invalid state
                mock_retrieve.side_effect = ValueError("Invalid")
                with pytest.raises(ValueError, match="Invalid state parameter"):
                    auth(provider, authorization_code="code", state_param="sp")

    @patch("core.mcp.auth.auth_flow.discover_oauth_metadata")
    def test_auth_orchestration_refresh_failure(self, mock_discover, provider):
        provider.server_url = "https://api"
        provider.credentials = {"client_information": {"client_id": "c1"}}
        provider.credentials.update(access_token="at", token_type="Bearer", refresh_token="rt")

        asm = OAuthMetadata(
            authorization_endpoint="https://auth/auth",
            token_endpoint="https://auth/token",
            response_types_supported=["code"],
            grant_types_supported=["authorization_code"],
        )
        mock_discover.return_value = (asm, None, None)

        with patch("core.mcp.auth.auth_flow.refresh_authorization") as mock_refresh:
            mock_refresh.side_effect = ValueError("Refresh Failed")
            with pytest.raises(ValueError, match="Could not refresh OAuth tokens"):
                auth(provider)
