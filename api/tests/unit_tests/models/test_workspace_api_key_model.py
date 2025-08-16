"""
Unit tests for WorkspaceApiKey model.

Tests pure functions and properties without database access.
Focuses on data transformation, validation, and business logic.
"""

from unittest.mock import patch

from models.workspace_api_key import WorkspaceApiKey
from tests.unit_tests.workspace_api_key_test_builders import WorkspaceApiKeyBuilder


class TestWorkspaceApiKeyModel:
    """Unit tests for WorkspaceApiKey model methods and properties."""

    def test_to_dict_returns_correct_format(self):
        """Test that to_dict() returns the expected dictionary format."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().with_name("test-key").build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert isinstance(result, dict)
        assert result["name"] == "test-key"
        assert result["type"] == "workspace"
        assert "token" in result
        assert result["token"].endswith("...")  # Token should be masked
        assert "scopes" in result
        assert "created_at" in result
        assert "is_expired" in result

    def test_to_dict_with_expired_key(self):
        """Test to_dict() correctly identifies expired keys."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().expired(days_ago=1).build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["is_expired"] is True
        assert result["expires_at"] is not None

    def test_to_dict_with_non_expired_key(self):
        """Test to_dict() correctly identifies non-expired keys."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().expires_in(days=30).build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["is_expired"] is False
        assert result["expires_at"] is not None

    def test_to_dict_with_no_expiration(self):
        """Test to_dict() handles keys with no expiration date."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["is_expired"] is False
        assert result["expires_at"] is None

    def test_to_auth_dict_returns_correct_format(self):
        """Test that to_auth_dict() returns the expected authentication format."""
        # Arrange
        api_key = (
            WorkspaceApiKeyBuilder()
            .with_tenant_id("test-tenant")
            .with_name("auth-key")
            .with_token("encrypted-token")
            .with_created_by("user-123")
            .with_workspace_scopes(["workspace:read", "apps:write"])
            .build()
        )

        # Act
        result = api_key.to_auth_dict()

        # Assert
        assert result == {
            "tenant_id": "test-tenant",
            "token": "encrypted-token",
            "name": "auth-key",
            "scopes": ["workspace:read", "apps:write"],
            "account_id": "user-123",
        }

    def test_scopes_list_property_with_valid_json(self):
        """Test scopes_list property with valid JSON string."""
        # Arrange
        scopes = ["workspace:read", "apps:write", "members:admin"]
        api_key = WorkspaceApiKeyBuilder().with_workspace_scopes(scopes).build()

        # Act
        result = api_key.scopes_list

        # Assert
        assert result == scopes

    def test_scopes_list_property_with_invalid_json(self):
        """Test scopes_list property handles invalid JSON gracefully."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().with_scopes_json("invalid-json").build()

        # Act
        result = api_key.scopes_list

        # Assert
        assert result == []  # Should return empty list for invalid JSON

    def test_scopes_list_property_with_empty_string(self):
        """Test scopes_list property handles empty string."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().with_scopes_json("").build()

        # Act
        result = api_key.scopes_list

        # Assert
        assert result == []

    def test_scopes_list_property_with_null_value(self):
        """Test scopes_list property handles null value."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().with_scopes_json(None).build()

        # Act
        result = api_key.scopes_list

        # Assert
        assert result == []

    def test_generate_api_key_returns_correct_prefix(self):
        """Test generate_api_key() static method returns token with correct wsk- prefix."""
        # Act
        with patch("models.model.ApiToken.generate_api_key") as mock_generate:
            mock_generate.return_value = "wsk-test123456789012345678901234567890"
            token = WorkspaceApiKey.generate_api_key()

        # Assert
        assert token.startswith("wsk-")
        mock_generate.assert_called_once_with("wsk-", 32)

    def test_generate_api_key_returns_correct_length(self):
        """Test generate_api_key() returns token with correct total length (prefix + 32 chars)."""
        # Act
        with patch("models.model.ApiToken.generate_api_key") as mock_generate:
            # wsk- (4 chars) + 32 random chars = 36 total chars
            mock_generate.return_value = "wsk-" + "a" * 32
            token = WorkspaceApiKey.generate_api_key()

        # Assert
        assert len(token) == 36  # 4 (wsk-) + 32 (random chars)
        assert token.startswith("wsk-")
        mock_generate.assert_called_once_with("wsk-", 32)

    def test_generate_api_key_calls_with_correct_parameters(self):
        """Test generate_api_key() calls ApiToken.generate_api_key with correct parameters."""
        # Act
        with patch("models.model.ApiToken.generate_api_key") as mock_generate:
            mock_generate.return_value = "wsk-test123456789012345678901234567890"
            WorkspaceApiKey.generate_api_key()

        # Assert
        mock_generate.assert_called_once_with("wsk-", 32)

    def test_generate_api_key_uniqueness_basic_check(self):
        """Test that generate_api_key() produces different tokens on multiple calls."""
        # Act
        with patch("models.model.ApiToken.generate_api_key") as mock_generate:
            mock_generate.side_effect = ["wsk-token123456789012345678901234567", "wsk-token987654321098765432109876543"]

            token1 = WorkspaceApiKey.generate_api_key()
            token2 = WorkspaceApiKey.generate_api_key()

        # Assert
        assert token1 != token2
        assert token1.startswith("wsk-")
        assert token2.startswith("wsk-")
        assert len(token1) == 36
        assert len(token2) == 36

    def test_generate_api_key_format_validation(self):
        """Test generate_api_key() returns token in expected format pattern."""
        # Act
        with patch("models.model.ApiToken.generate_api_key") as mock_generate:
            mock_generate.return_value = "wsk-AbC123XyZ45678901234567890123456"
            token = WorkspaceApiKey.generate_api_key()

        # Assert
        assert token.startswith("wsk-")
        # Check that after prefix, we have alphanumeric characters
        token_suffix = token[4:]  # Remove 'wsk-' prefix
        assert len(token_suffix) == 32
        assert token_suffix.isalnum()  # Should be alphanumeric

    def test_generate_api_key_multiple_calls_different_results(self):
        """Test multiple calls to generate_api_key() return different tokens."""
        # Arrange - each token needs exactly 32 chars after 'wsk-'
        generated_tokens = [
            "wsk-abc123def456ghi789jkl012mno34567",  # 32 chars after wsk-
            "wsk-xyz987uvw654rst321opq098lmn76543",  # 32 chars after wsk-
            "wsk-pqr456stu789vwx012yzab345cde6789",  # 32 chars after wsk-
        ]

        # Act
        with patch("models.model.ApiToken.generate_api_key") as mock_generate:
            mock_generate.side_effect = generated_tokens

            tokens = [WorkspaceApiKey.generate_api_key() for _ in range(3)]

        # Assert
        assert len(set(tokens)) == 3  # All tokens should be unique
        for token in tokens:
            assert token.startswith("wsk-")
            assert len(token) == 36

    def test_token_masking_in_to_dict(self):
        """Test that tokens are properly masked in to_dict() output."""
        # Arrange
        long_token = "encrypted-very-long-token-that-should-be-masked"
        api_key = WorkspaceApiKeyBuilder().with_token(long_token).build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["token"] == "encrypte..."
        assert len(result["token"]) == 11  # 8 chars + '...'

    def test_token_masking_with_short_token(self):
        """Test token masking with tokens shorter than 8 characters."""
        # Arrange
        short_token = "short"
        api_key = WorkspaceApiKeyBuilder().with_token(short_token).build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["token"] == "short..."

    def test_token_masking_with_empty_token(self):
        """Test token masking with empty token."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().with_token("").build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["token"] == ""

    def test_token_masking_with_none_token(self):
        """Test token masking with None token."""
        # Arrange
        api_key = WorkspaceApiKeyBuilder().with_token(None).build()

        # Act
        result = api_key.to_dict()

        # Assert
        assert result["token"] == ""
