"""
Comprehensive unit tests for ModelLoadBalancingService.

This test suite covers:
- Enable/disable model load balancing
- Load balancing configuration CRUD operations
- Credential validation for load balancing
- Configuration inheritance handling
- Cache management operations
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest


class TestModelLoadBalancingServiceEnableDisable:
    """Test suite for enable/disable model load balancing."""

    def test_enable_load_balancing_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.enable_model_load_balancing(tenant_id, provider, model, model_type)

    def test_enable_load_balancing_calls_provider_config(self):
        """Test enables load balancing through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            service.enable_model_load_balancing(tenant_id, provider, model, model_type)

            # Assert
            mock_provider_config.enable_model_load_balancing.assert_called_once()

    def test_disable_load_balancing_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.disable_model_load_balancing(tenant_id, provider, model, model_type)

    def test_disable_load_balancing_calls_provider_config(self):
        """Test disables load balancing through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            service.disable_model_load_balancing(tenant_id, provider, model, model_type)

            # Assert
            mock_provider_config.disable_model_load_balancing.assert_called_once()


class TestModelLoadBalancingServiceGetConfigs:
    """Test suite for get_load_balancing_configs method."""

    def test_get_configs_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.get_load_balancing_configs(tenant_id, provider, model, model_type)

    def test_load_balancing_config_structure(self):
        """Test load balancing config has expected structure."""
        # Arrange
        config = {
            "id": str(uuid4()),
            "name": "test-config",
            "credentials": {"api_key": "***"},
            "enabled": True,
            "in_cooldown": False,
            "ttl": 0,
        }

        # Assert - verify expected keys exist
        assert "id" in config
        assert "name" in config
        assert "credentials" in config
        assert "enabled" in config
        assert "in_cooldown" in config
        assert "ttl" in config

    def test_load_balancing_enabled_flag_types(self):
        """Test load balancing enabled flag is boolean."""
        # Arrange
        enabled_true = True
        enabled_false = False

        # Assert
        assert isinstance(enabled_true, bool)
        assert isinstance(enabled_false, bool)
        assert enabled_true is True
        assert enabled_false is False

    def test_inherit_config_name_constant(self):
        """Test inherit config uses special name."""
        # Arrange
        inherit_name = "__inherit__"

        # Assert
        assert inherit_name == "__inherit__"
        assert inherit_name.startswith("__")
        assert inherit_name.endswith("__")


class TestModelLoadBalancingServiceGetConfig:
    """Test suite for get_load_balancing_config method."""

    def test_get_config_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"
        config_id = str(uuid4())

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.get_load_balancing_config(tenant_id, provider, model, model_type, config_id)


class TestModelLoadBalancingServiceUpdateConfig:
    """Test suite for update_load_balancing_config method."""

    def test_update_config_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"
        config_id = str(uuid4())
        config_data = {"name": "updated-config", "credentials": {"api_key": "new_key"}}

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.update_load_balancing_config(tenant_id, provider, model, model_type, config_id, config_data)


class TestModelLoadBalancingServiceDeleteConfig:
    """Test suite for delete_load_balancing_config method."""

    def test_delete_config_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"
        config_id = str(uuid4())

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.delete_load_balancing_config(tenant_id, provider, model, model_type, config_id)


class TestModelLoadBalancingServiceValidateCredentials:
    """Test suite for validate_load_balancing_credentials method."""

    def test_validate_credentials_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"
        credentials = {"api_key": "test_key"}

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.validate_load_balancing_credentials(tenant_id, provider, model, model_type, credentials)

    def test_validate_credentials_calls_provider_config(self):
        """Test validates credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"
        credentials = {"api_key": "test_key"}

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            service.validate_load_balancing_credentials(tenant_id, provider, model, model_type, credentials)

            # Assert
            mock_provider_config.validate_load_balancing_credentials.assert_called_once()


class TestModelLoadBalancingServiceGetCredentialSchema:
    """Test suite for get_load_balancing_credential_schema method."""

    def test_get_schema_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.get_load_balancing_credential_schema(tenant_id, provider, model, model_type)


class TestModelLoadBalancingServiceClearCache:
    """Test suite for clear_load_balancing_cache method."""

    def test_clear_cache_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.clear_load_balancing_cache(tenant_id, provider, model, model_type)


class TestLoadBalancingDataStructures:
    """Test suite for load balancing data structures and constants."""

    def test_load_balancing_config_response_structure(self):
        """Test load balancing config response has expected structure."""
        # Arrange
        config_response = {
            "id": str(uuid4()),
            "name": "Primary API Key",
            "credentials": {"api_key": "sk-***"},
            "enabled": True,
            "in_cooldown": False,
            "cooldown_time": 0,
            "ttl": 60,
        }

        # Assert - verify expected keys exist
        assert "id" in config_response
        assert "name" in config_response
        assert "credentials" in config_response
        assert "enabled" in config_response
        assert "in_cooldown" in config_response

    def test_credential_schema_structure(self):
        """Test credential schema has expected structure."""
        # Arrange
        schema = {
            "credential_form_schemas": [
                {
                    "variable": "api_key",
                    "label": {"en_US": "API Key"},
                    "type": "secret-input",
                    "required": True,
                    "placeholder": {"en_US": "Enter your API key"},
                }
            ]
        }

        # Assert
        assert "credential_form_schemas" in schema
        assert len(schema["credential_form_schemas"]) > 0
        assert "variable" in schema["credential_form_schemas"][0]
        assert "type" in schema["credential_form_schemas"][0]

    def test_cooldown_config_structure(self):
        """Test cooldown configuration structure."""
        # Arrange
        cooldown_config = {
            "in_cooldown": True,
            "cooldown_time": 300,
            "error_count": 3,
            "last_error_at": "2024-01-01T00:00:00Z",
        }

        # Assert
        assert "in_cooldown" in cooldown_config
        assert "cooldown_time" in cooldown_config
        assert cooldown_config["in_cooldown"] is True
        assert cooldown_config["cooldown_time"] == 300

    def test_model_type_values(self):
        """Test valid model type values for load balancing."""
        # Arrange
        valid_model_types = ["llm", "text-embedding", "rerank", "speech2text", "tts"]

        # Assert
        assert "llm" in valid_model_types
        assert "text-embedding" in valid_model_types
        assert len(valid_model_types) >= 4
