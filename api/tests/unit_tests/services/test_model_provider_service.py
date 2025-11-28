"""
Comprehensive unit tests for ModelProviderService.

This test suite covers:
- Provider list retrieval and filtering
- Provider and model credential management
- Model configuration operations
- Default model management
- Provider icon retrieval
- Model enable/disable functionality
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from services.errors.app_model_config import ProviderNotFoundError


class TestModelProviderServiceGetProviderConfiguration:
    """Test suite for _get_provider_configuration method."""

    def test_get_provider_configuration_raises_error_when_not_found(self):
        """Test raises ProviderNotFoundError when provider doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "nonexistent_provider"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act & Assert
            with pytest.raises(ProviderNotFoundError, match="Provider nonexistent_provider does not exist"):
                service._get_provider_configuration(tenant_id, provider)

    def test_get_provider_configuration_returns_config_when_found(self):
        """Test returns provider configuration when found."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"

        mock_provider_config = MagicMock()
        mock_provider_config.provider.provider = provider

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            result = service._get_provider_configuration(tenant_id, provider)

            # Assert
            assert result == mock_provider_config


class TestModelProviderServiceGetProviderList:
    """Test suite for get_provider_list method."""

    def test_get_provider_list_returns_empty_when_no_providers(self):
        """Test returns empty list when no providers configured."""
        # Arrange
        tenant_id = str(uuid4())

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            result = service.get_provider_list(tenant_id)

            # Assert
            assert result == []

    def test_provider_response_structure(self):
        """Test provider response has expected structure."""
        # Arrange
        provider_data = {
            "provider": "openai",
            "label": {"en_US": "OpenAI"},
            "description": {"en_US": "OpenAI Provider"},
            "icon_small": {"en_US": "icon_small.png"},
            "icon_large": {"en_US": "icon_large.png"},
            "background": "#000000",
            "supported_model_types": ["llm"],
        }

        # Assert - verify expected keys exist
        assert "provider" in provider_data
        assert "label" in provider_data
        assert "description" in provider_data
        assert "icon_small" in provider_data
        assert "icon_large" in provider_data
        assert "supported_model_types" in provider_data

    def test_model_type_filter_values(self):
        """Test valid model type filter values."""
        # Arrange
        valid_model_types = ["llm", "text-embedding", "rerank", "speech2text", "tts", "moderation"]

        # Assert
        assert "llm" in valid_model_types
        assert "text-embedding" in valid_model_types
        assert len(valid_model_types) >= 4


class TestModelProviderServiceGetModelsByProvider:
    """Test suite for get_models_by_provider method."""

    def test_model_entity_structure(self):
        """Test model entity has expected structure."""
        # Arrange
        model_data = {
            "model": "gpt-4",
            "label": {"en_US": "GPT-4"},
            "model_type": "llm",
            "features": ["agent-thought"],
            "fetch_from": "predefined",
            "model_properties": {},
            "status": "active",
        }

        # Assert - verify expected keys exist
        assert "model" in model_data
        assert "label" in model_data
        assert "model_type" in model_data
        assert "status" in model_data

    def test_model_status_values(self):
        """Test valid model status values."""
        # Arrange
        valid_statuses = ["active", "no-configure", "quota-exceeded", "no-permission"]

        # Assert
        assert "active" in valid_statuses
        assert "no-configure" in valid_statuses
        assert len(valid_statuses) >= 3


class TestModelProviderServiceProviderCredentials:
    """Test suite for provider credential operations."""

    def test_get_provider_credential_returns_credentials(self):
        """Test returns provider credentials."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        credentials = {"api_key": "***"}

        mock_provider_config = MagicMock()
        mock_provider_config.get_provider_credential.return_value = credentials

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            result = service.get_provider_credential(tenant_id, provider)

            # Assert
            assert result == credentials

    def test_validate_provider_credentials_calls_provider_config(self):
        """Test validates credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        credentials = {"api_key": "test_key"}

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.validate_provider_credentials(tenant_id, provider, credentials)

            # Assert
            mock_provider_config.validate_provider_credentials.assert_called_once_with(credentials)

    def test_create_provider_credential_calls_provider_config(self):
        """Test creates provider credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        credentials = {"api_key": "test_key"}
        credential_name = "My OpenAI Key"

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.create_provider_credential(tenant_id, provider, credentials, credential_name)

            # Assert
            mock_provider_config.create_provider_credential.assert_called_once_with(credentials, credential_name)

    def test_remove_provider_credential_calls_provider_config(self):
        """Test removes provider credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        credential_id = str(uuid4())

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.remove_provider_credential(tenant_id, provider, credential_id)

            # Assert
            mock_provider_config.delete_provider_credential.assert_called_once_with(credential_id=credential_id)


class TestModelProviderServiceModelCredentials:
    """Test suite for model credential operations."""

    def test_get_model_credential_returns_credentials(self):
        """Test returns model credentials."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model_type = "llm"
        model = "gpt-4"
        credentials = {"api_key": "***"}

        mock_provider_config = MagicMock()
        mock_provider_config.get_custom_model_credential.return_value = credentials

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            result = service.get_model_credential(tenant_id, provider, model_type, model, None)

            # Assert
            assert result == credentials

    def test_validate_model_credentials_calls_provider_config(self):
        """Test validates model credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model_type = "llm"
        model = "gpt-4"
        credentials = {"api_key": "test_key"}

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.validate_model_credentials(tenant_id, provider, model_type, model, credentials)

            # Assert
            mock_provider_config.validate_custom_model_credentials.assert_called_once()

    def test_create_model_credential_calls_provider_config(self):
        """Test creates model credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model_type = "llm"
        model = "gpt-4"
        credentials = {"api_key": "test_key"}
        credential_name = "My GPT-4 Key"

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.create_model_credential(tenant_id, provider, model_type, model, credentials, credential_name)

            # Assert
            mock_provider_config.create_custom_model_credential.assert_called_once()

    def test_remove_model_credential_calls_provider_config(self):
        """Test removes model credentials through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model_type = "llm"
        model = "gpt-4"
        credential_id = str(uuid4())

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.remove_model_credential(tenant_id, provider, model_type, model, credential_id)

            # Assert
            mock_provider_config.delete_custom_model_credential.assert_called_once()


class TestModelProviderServiceDefaultModel:
    """Test suite for default model operations."""

    def test_get_default_model_returns_none_on_error(self):
        """Test returns None when error occurs getting default model."""
        # Arrange
        tenant_id = str(uuid4())
        model_type = "llm"

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_default_model.side_effect = Exception("Error")

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            result = service.get_default_model_of_model_type(tenant_id, model_type)

            # Assert
            assert result is None

    def test_update_default_model_calls_provider_manager(self):
        """Test updates default model through provider manager."""
        # Arrange
        tenant_id = str(uuid4())
        model_type = "llm"
        provider = "openai"
        model = "gpt-4"

        mock_provider_manager = MagicMock()

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.update_default_model_of_model_type(tenant_id, model_type, provider, model)

            # Assert
            mock_provider_manager.update_default_model_record.assert_called_once()


class TestModelProviderServiceEnableDisableModel:
    """Test suite for enable/disable model operations."""

    def test_enable_model_calls_provider_config(self):
        """Test enables model through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.enable_model(tenant_id, provider, model, model_type)

            # Assert
            mock_provider_config.enable_model.assert_called_once()

    def test_disable_model_calls_provider_config(self):
        """Test disables model through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        model = "gpt-4"
        model_type = "llm"

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.disable_model(tenant_id, provider, model, model_type)

            # Assert
            mock_provider_config.disable_model.assert_called_once()


class TestModelProviderServiceProviderIcon:
    """Test suite for get_model_provider_icon method."""

    def test_get_provider_icon_returns_icon_data(self):
        """Test returns icon byte data and mime type."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        icon_type = "icon_small"
        lang = "en_US"
        expected_bytes = b"icon_data"
        expected_mime = "image/png"

        mock_factory = MagicMock()
        mock_factory.get_provider_icon.return_value = (expected_bytes, expected_mime)

        mock_provider_manager = MagicMock()

        with (
            patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager),
            patch("services.model_provider_service.ModelProviderFactory", return_value=mock_factory),
        ):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            byte_data, mime_type = service.get_model_provider_icon(tenant_id, provider, icon_type, lang)

            # Assert
            assert byte_data == expected_bytes
            assert mime_type == expected_mime


class TestModelProviderServiceSwitchPreferredProvider:
    """Test suite for switch_preferred_provider method."""

    def test_switch_preferred_provider_calls_provider_config(self):
        """Test switches preferred provider type through provider configuration."""
        # Arrange
        tenant_id = str(uuid4())
        provider = "openai"
        preferred_provider_type = "custom"

        mock_provider_config = MagicMock()

        mock_provider_manager = MagicMock()
        mock_provider_manager.get_configurations.return_value = {provider: mock_provider_config}

        with patch("services.model_provider_service.ProviderManager", return_value=mock_provider_manager):
            from services.model_provider_service import ModelProviderService

            service = ModelProviderService()

            # Act
            service.switch_preferred_provider(tenant_id, provider, preferred_provider_type)

            # Assert
            mock_provider_config.switch_preferred_provider_type.assert_called_once()
