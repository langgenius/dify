"""
Test cases for workflow-level credential override functionality.
Tests the CredentialOverride class and _fetch_override_credentials function.
"""

import re
from unittest.mock import Mock, patch

import pytest

from core.workflow.nodes.llm.entities import CredentialOverride
from core.workflow.nodes.llm.llm_utils import _fetch_override_credentials


class TestCredentialOverride:
    """Test credential override functionality"""

    def test_fetch_override_credentials_by_id(self):
        """Test fetching credentials by credential ID"""
        # Mock provider configuration
        mock_provider_config = Mock()
        mock_provider_config.get_provider_credential.return_value = {
            "openai_api_key": "sk-test-key-123",
            "model": "gpt-4",
        }

        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_get_configs.return_value = {
                "openai": mock_provider_config,
            }

            # Test successful fetch by ID
            result = _fetch_override_credentials(
                tenant_id="test-tenant",
                provider="openai",
                model="gpt-4",
                credential_override=CredentialOverride(credential_id="test-cred-123"),
            )

            assert result["openai_api_key"] == "sk-test-key-123"
            assert result["model"] == "gpt-4"

    def test_fetch_override_credentials_by_name(self):
        """Test fetching credentials by credential name"""
        mock_provider_config = Mock()
        mock_provider_config.get_custom_model_credential.return_value = {
            "openai_api_key": "sk-test-key-456",
            "model": "gpt-3.5-turbo",
        }

        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_get_configs.return_value = {
                "openai": mock_provider_config,
            }

            # Mock model configuration with available credentials
            mock_model_config = Mock()
            mock_model_config.available_model_credentials = [
                Mock(credential_name="API Key 1 (Production)"),
                Mock(credential_name="API Key 2 (Staging)"),
            ]
            mock_provider_config.custom_configuration.models = [mock_model_config]

            # Test successful fetch by name
            result = _fetch_override_credentials(
                tenant_id="test-tenant",
                provider="openai",
                model="gpt-3.5-turbo",
                credential_override=CredentialOverride(credential_name="API Key 1 (Production)"),
            )

            assert result["openai_api_key"] == "sk-test-key-456"

    def test_fetch_override_credentials_not_found(self):
        """Test error handling when credential not found"""
        mock_provider_config = Mock()
        mock_provider_config.get_provider_credential.side_effect = ValueError("Credential not found")
        mock_provider_config.get_custom_model_credential.side_effect = ValueError("Credential not found")
        mock_provider_config.custom_configuration.models = []

        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_get_configs.return_value = {
                "openai": mock_provider_config,
            }

            # Test ID not found
            with pytest.raises(ValueError, match="Credential with ID test-cred-123 not found"):
                _fetch_override_credentials(
                    tenant_id="test-tenant",
                    provider="openai",
                    model="gpt-4",
                    credential_override=CredentialOverride(credential_id="test-cred-123"),
                )

            # Test name not found (escape regex metacharacters in message)
            with pytest.raises(ValueError, match=re.escape("Credential with name 'API Key 1 (Production)' not found")):
                _fetch_override_credentials(
                    tenant_id="test-tenant",
                    provider="openai",
                    model="gpt-3.5-turbo",
                    credential_override=CredentialOverride(credential_name="API Key 1 (Production)"),
                )

    def test_fetch_override_credentials_fallback_to_default(self):
        """Test fallback to default credentials when override is invalid"""
        with patch("core.provider_manager.ProviderManager.get_configurations") as mock_get_configs:
            mock_get_configs.return_value = {
                "openai": Mock(),  # No provider configuration
            }

            # Should not raise error, should return None and log warning
            result = _fetch_override_credentials(
                tenant_id="test-tenant",
                provider="openai",
                model="gpt-4",
                credential_override=CredentialOverride(credential_id="invalid-id"),
            )

            # Function should handle the error gracefully and return None
            assert result is None

    def test_empty_credential_override(self):
        """Test handling of empty credential override"""
        # Should not raise error for empty override
        result = _fetch_override_credentials(
            tenant_id="test-tenant", provider="openai", model="gpt-4", credential_override=CredentialOverride()
        )

        assert result is None
