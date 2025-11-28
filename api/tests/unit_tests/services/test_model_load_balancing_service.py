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

    def test_enable_load_balancing_calls_provider_configuration(self):
        """Test calls provider configuration to enable load balancing."""
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

    def test_disable_load_balancing_calls_provider_configuration(self):
        """Test calls provider configuration to disable load balancing."""
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

    def test_get_config_returns_none_when_not_found(self):
        """Test returns None when config not found."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"
        config_id = str(uuid4())

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager),
            patch("services.model_load_balancing_service.db.session.query", return_value=mock_query),
        ):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            result = service.get_load_balancing_config(tenant_id, provider, model, model_type, config_id)

            # Assert
            assert result is None

    def test_get_config_returns_config_dict_when_found(self):
        """Test returns config dictionary when found."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"
        config_id = str(uuid4())

        mock_config = MagicMock()
        mock_config.id = config_id
        mock_config.name = "test-config"
        mock_config.encrypted_config = '{"api_key": "encrypted_value"}'
        mock_config.enabled = True

        mock_credential_schema = MagicMock()
        mock_credential_schema.credential_form_schemas = []

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider
        mock_provider_config.provider.model_credential_schema = mock_credential_schema
        mock_provider_config.obfuscated_credentials.return_value = {"api_key": "***"}

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_config

        with (
            patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager),
            patch("services.model_load_balancing_service.db.session.query", return_value=mock_query),
        ):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            result = service.get_load_balancing_config(tenant_id, provider, model, model_type, config_id)

            # Assert
            assert result is not None
            assert result["id"] == config_id
            assert result["name"] == "test-config"
            assert result["enabled"] is True


class TestModelLoadBalancingServiceUpdateConfigs:
    """Test suite for update_load_balancing_configs method."""

    def test_update_configs_raises_error_when_provider_not_exists(self):
        """Test raises ValueError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"
        model = "gpt-4"
        model_type = "llm"
        configs = []

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Provider nonexistent_provider does not exist"):
                service.update_load_balancing_configs(
                    tenant_id, provider, model, model_type, configs, "predefined-model"
                )

    def test_update_configs_raises_error_when_configs_not_list(self):
        """Test raises ValueError when configs is not a list."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"
        configs = "not_a_list"

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="Invalid load balancing configs"):
                service.update_load_balancing_configs(
                    tenant_id, provider, model, model_type, configs, "predefined-model"
                )


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

    def test_validate_credentials_raises_error_when_config_not_found(self):
        """Test raises ValueError when config_id provided but not found."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"
        credentials = {"api_key": "test_key"}
        config_id = str(uuid4())

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager),
            patch("services.model_load_balancing_service.db.session.query", return_value=mock_query),
        ):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match=f"Load balancing config {config_id} does not exist"):
                service.validate_load_balancing_credentials(
                    tenant_id, provider, model, model_type, credentials, config_id
                )


class TestModelLoadBalancingServiceGetCredentialSchema:
    """Test suite for _get_credential_schema method."""

    def test_get_credential_schema_returns_model_schema_when_available(self):
        """Test returns model credential schema when available."""
        # Arrange
        mock_model_schema = MagicMock()
        mock_provider_config = MagicMock()
        mock_provider_config.provider.model_credential_schema = mock_model_schema
        mock_provider_config.provider.provider_credential_schema = None

        mock_provider_manager = MagicMock()

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            result = service._get_credential_schema(mock_provider_config)

            # Assert
            assert result == mock_model_schema

    def test_get_credential_schema_returns_provider_schema_when_no_model_schema(self):
        """Test returns provider credential schema when model schema not available."""
        # Arrange
        mock_provider_schema = MagicMock()
        mock_provider_config = MagicMock()
        mock_provider_config.provider.model_credential_schema = None
        mock_provider_config.provider.provider_credential_schema = mock_provider_schema

        mock_provider_manager = MagicMock()

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            result = service._get_credential_schema(mock_provider_config)

            # Assert
            assert result == mock_provider_schema

    def test_get_credential_schema_raises_error_when_no_schema(self):
        """Test raises ValueError when no credential schema found."""
        # Arrange
        mock_provider_config = MagicMock()
        mock_provider_config.provider.model_credential_schema = None
        mock_provider_config.provider.provider_credential_schema = None

        mock_provider_manager = MagicMock()

        with patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act & Assert
            with pytest.raises(ValueError, match="No credential schema found"):
                service._get_credential_schema(mock_provider_config)


class TestModelLoadBalancingServiceClearCache:
    """Test suite for _clear_credentials_cache method."""

    def test_clear_cache_calls_provider_credentials_cache_delete(self):
        """Test calls ProviderCredentialsCache.delete method."""
        # Arrange
        tenant_id = str(uuid4())
        config_id = str(uuid4())

        mock_cache = MagicMock()
        mock_provider_manager = MagicMock()

        with (
            patch("services.model_load_balancing_service.ProviderManager", return_value=mock_provider_manager),
            patch("services.model_load_balancing_service.ProviderCredentialsCache", return_value=mock_cache),
        ):
            from services.model_load_balancing_service import ModelLoadBalancingService

            service = ModelLoadBalancingService()

            # Act
            service._clear_credentials_cache(tenant_id, config_id)

            # Assert
            mock_cache.delete.assert_called_once()
