from unittest.mock import Mock, patch

import pytest

from core.entities.provider_configuration import ProviderConfiguration, SystemConfigurationStatus
from core.entities.provider_entities import (
    CustomConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from models.provider import Provider, ProviderType


@pytest.fixture
def mock_provider_entity():
    """Mock provider entity with basic configuration"""
    provider_entity = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
        description=I18nObject(en_US="OpenAI provider", zh_Hans="OpenAI 提供商"),
        icon_small=I18nObject(en_US="icon.png", zh_Hans="icon.png"),
        icon_large=I18nObject(en_US="icon.png", zh_Hans="icon.png"),
        background="background.png",
        help=None,
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        provider_credential_schema=None,
        model_credential_schema=None,
    )

    return provider_entity


@pytest.fixture
def mock_system_configuration():
    """Mock system configuration"""
    quota_config = QuotaConfiguration(
        quota_type=ProviderQuotaType.TRIAL,
        quota_unit=QuotaUnit.TOKENS,
        quota_limit=1000,
        quota_used=0,
        is_valid=True,
        restrict_models=[RestrictModel(model="gpt-4", reason="Experimental", model_type=ModelType.LLM)],
    )

    system_config = SystemConfiguration(
        enabled=True,
        credentials={"openai_api_key": "test_key"},
        quota_configurations=[quota_config],
        current_quota_type=ProviderQuotaType.TRIAL,
    )

    return system_config


@pytest.fixture
def mock_custom_configuration():
    """Mock custom configuration"""
    custom_config = CustomConfiguration(provider=None, models=[])
    return custom_config


@pytest.fixture
def provider_configuration(mock_provider_entity, mock_system_configuration, mock_custom_configuration):
    """Create a test provider configuration instance"""
    with patch("core.entities.provider_configuration.original_provider_configurate_methods", {}):
        return ProviderConfiguration(
            tenant_id="test_tenant",
            provider=mock_provider_entity,
            preferred_provider_type=ProviderType.SYSTEM,
            using_provider_type=ProviderType.SYSTEM,
            system_configuration=mock_system_configuration,
            custom_configuration=mock_custom_configuration,
            model_settings=[],
        )


class TestProviderConfiguration:
    """Test cases for ProviderConfiguration class"""

    def test_get_current_credentials_system_provider_success(self, provider_configuration):
        """Test successfully getting credentials from system provider"""
        # Arrange
        provider_configuration.using_provider_type = ProviderType.SYSTEM

        # Act
        credentials = provider_configuration.get_current_credentials(ModelType.LLM, "gpt-4")

        # Assert
        assert credentials == {"openai_api_key": "test_key"}

    def test_get_current_credentials_model_disabled(self, provider_configuration):
        """Test getting credentials when model is disabled"""
        # Arrange
        model_setting = ModelSettings(
            model="gpt-4",
            model_type=ModelType.LLM,
            enabled=False,
            load_balancing_configs=[],
            has_invalid_load_balancing_configs=False,
        )
        provider_configuration.model_settings = [model_setting]

        # Act & Assert
        with pytest.raises(ValueError, match="Model gpt-4 is disabled"):
            provider_configuration.get_current_credentials(ModelType.LLM, "gpt-4")

    def test_get_current_credentials_custom_provider_with_models(self, provider_configuration):
        """Test getting credentials from custom provider with model configurations"""
        # Arrange
        provider_configuration.using_provider_type = ProviderType.CUSTOM

        mock_model_config = Mock()
        mock_model_config.model_type = ModelType.LLM
        mock_model_config.model = "gpt-4"
        mock_model_config.credentials = {"openai_api_key": "custom_key"}
        provider_configuration.custom_configuration.models = [mock_model_config]

        # Act
        credentials = provider_configuration.get_current_credentials(ModelType.LLM, "gpt-4")

        # Assert
        assert credentials == {"openai_api_key": "custom_key"}

    def test_get_system_configuration_status_active(self, provider_configuration):
        """Test getting active system configuration status"""
        # Arrange
        provider_configuration.system_configuration.enabled = True

        # Act
        status = provider_configuration.get_system_configuration_status()

        # Assert
        assert status == SystemConfigurationStatus.ACTIVE

    def test_get_system_configuration_status_unsupported(self, provider_configuration):
        """Test getting unsupported system configuration status"""
        # Arrange
        provider_configuration.system_configuration.enabled = False

        # Act
        status = provider_configuration.get_system_configuration_status()

        # Assert
        assert status == SystemConfigurationStatus.UNSUPPORTED

    def test_get_system_configuration_status_quota_exceeded(self, provider_configuration):
        """Test getting quota exceeded system configuration status"""
        # Arrange
        provider_configuration.system_configuration.enabled = True
        quota_config = provider_configuration.system_configuration.quota_configurations[0]
        quota_config.is_valid = False

        # Act
        status = provider_configuration.get_system_configuration_status()

        # Assert
        assert status == SystemConfigurationStatus.QUOTA_EXCEEDED

    def test_is_custom_configuration_available_with_provider(self, provider_configuration):
        """Test custom configuration availability with provider credentials"""
        # Arrange
        mock_provider = Mock()
        mock_provider.available_credentials = ["openai_api_key"]
        provider_configuration.custom_configuration.provider = mock_provider
        provider_configuration.custom_configuration.models = []

        # Act
        result = provider_configuration.is_custom_configuration_available()

        # Assert
        assert result is True

    def test_is_custom_configuration_available_with_models(self, provider_configuration):
        """Test custom configuration availability with model configurations"""
        # Arrange
        provider_configuration.custom_configuration.provider = None
        provider_configuration.custom_configuration.models = [Mock()]

        # Act
        result = provider_configuration.is_custom_configuration_available()

        # Assert
        assert result is True

    def test_is_custom_configuration_available_false(self, provider_configuration):
        """Test custom configuration not available"""
        # Arrange
        provider_configuration.custom_configuration.provider = None
        provider_configuration.custom_configuration.models = []

        # Act
        result = provider_configuration.is_custom_configuration_available()

        # Assert
        assert result is False

    @patch("core.entities.provider_configuration.Session")
    def test_get_provider_record_found(self, mock_session, provider_configuration):
        """Test getting provider record successfully"""
        # Arrange
        mock_provider = Mock(spec=Provider)
        mock_session_instance = Mock()
        mock_session.return_value.__enter__.return_value = mock_session_instance
        mock_session_instance.execute.return_value.scalar_one_or_none.return_value = mock_provider

        # Act
        result = provider_configuration._get_provider_record(mock_session_instance)

        # Assert
        assert result == mock_provider

    @patch("core.entities.provider_configuration.Session")
    def test_get_provider_record_not_found(self, mock_session, provider_configuration):
        """Test getting provider record when not found"""
        # Arrange
        mock_session_instance = Mock()
        mock_session.return_value.__enter__.return_value = mock_session_instance
        mock_session_instance.execute.return_value.scalar_one_or_none.return_value = None

        # Act
        result = provider_configuration._get_provider_record(mock_session_instance)

        # Assert
        assert result is None

    def test_init_with_customizable_model_only(
        self, mock_provider_entity, mock_system_configuration, mock_custom_configuration
    ):
        """Test initialization with customizable model only configuration"""
        # Arrange
        mock_provider_entity.configurate_methods = [ConfigurateMethod.CUSTOMIZABLE_MODEL]

        # Act
        with patch("core.entities.provider_configuration.original_provider_configurate_methods", {}):
            config = ProviderConfiguration(
                tenant_id="test_tenant",
                provider=mock_provider_entity,
                preferred_provider_type=ProviderType.SYSTEM,
                using_provider_type=ProviderType.SYSTEM,
                system_configuration=mock_system_configuration,
                custom_configuration=mock_custom_configuration,
                model_settings=[],
            )

        # Assert
        assert ConfigurateMethod.PREDEFINED_MODEL in config.provider.configurate_methods

    def test_get_current_credentials_with_restricted_models(self, provider_configuration):
        """Test getting credentials with model restrictions"""
        # Arrange
        provider_configuration.using_provider_type = ProviderType.SYSTEM

        # Act
        credentials = provider_configuration.get_current_credentials(ModelType.LLM, "gpt-3.5-turbo")

        # Assert
        assert credentials is not None
        assert "openai_api_key" in credentials

    @patch("core.entities.provider_configuration.Session")
    def test_get_specific_provider_credential_success(self, mock_session, provider_configuration):
        """Test getting specific provider credential successfully"""
        # Arrange
        credential_id = "test_credential_id"
        mock_credential = Mock()
        mock_credential.encrypted_config = '{"openai_api_key": "encrypted_key"}'

        mock_session_instance = Mock()
        mock_session.return_value.__enter__.return_value = mock_session_instance
        mock_session_instance.execute.return_value.scalar_one_or_none.return_value = mock_credential

        # Act
        with patch.object(provider_configuration, "_get_specific_provider_credential") as mock_get:
            mock_get.return_value = {"openai_api_key": "test_key"}
            result = provider_configuration._get_specific_provider_credential(credential_id)

        # Assert
        assert result == {"openai_api_key": "test_key"}

    @patch("core.entities.provider_configuration.Session")
    def test_get_specific_provider_credential_not_found(self, mock_session, provider_configuration):
        """Test getting specific provider credential when not found"""
        # Arrange
        credential_id = "nonexistent_credential_id"

        mock_session_instance = Mock()
        mock_session.return_value.__enter__.return_value = mock_session_instance
        mock_session_instance.execute.return_value.scalar_one_or_none.return_value = None

        # Act & Assert
        with patch.object(provider_configuration, "_get_specific_provider_credential") as mock_get:
            mock_get.return_value = None
            result = provider_configuration._get_specific_provider_credential(credential_id)
            assert result is None

        # Act
        credentials = provider_configuration.get_current_credentials(ModelType.LLM, "gpt-4")

        # Assert
        assert credentials == {"openai_api_key": "test_key"}
