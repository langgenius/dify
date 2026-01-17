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
from core.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FormOption,
    FormType,
    ProviderEntity,
)
from models.provider import Provider, ProviderType


@pytest.fixture
def mock_provider_entity():
    """Mock provider entity with basic configuration"""
    provider_entity = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
        description=I18nObject(en_US="OpenAI provider", zh_Hans="OpenAI 提供商"),
        icon_small=I18nObject(en_US="icon.png", zh_Hans="icon.png"),
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

    def test_extract_secret_variables_with_secret_input(self, provider_configuration):
        """Test extracting secret variables from credential form schemas"""
        # Arrange
        credential_form_schemas = [
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key", zh_Hans="API 密钥"),
                type=FormType.SECRET_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="model_name",
                label=I18nObject(en_US="Model Name", zh_Hans="模型名称"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="secret_token",
                label=I18nObject(en_US="Secret Token", zh_Hans="密钥令牌"),
                type=FormType.SECRET_INPUT,
                required=False,
            ),
        ]

        # Act
        secret_variables = provider_configuration.extract_secret_variables(credential_form_schemas)

        # Assert
        assert len(secret_variables) == 2
        assert "api_key" in secret_variables
        assert "secret_token" in secret_variables
        assert "model_name" not in secret_variables

    def test_extract_secret_variables_no_secret_input(self, provider_configuration):
        """Test extracting secret variables when no secret input fields exist"""
        # Arrange
        credential_form_schemas = [
            CredentialFormSchema(
                variable="model_name",
                label=I18nObject(en_US="Model Name", zh_Hans="模型名称"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="temperature",
                label=I18nObject(en_US="Temperature", zh_Hans="温度"),
                type=FormType.SELECT,
                required=True,
                options=[FormOption(label=I18nObject(en_US="0.1", zh_Hans="0.1"), value="0.1")],
            ),
        ]

        # Act
        secret_variables = provider_configuration.extract_secret_variables(credential_form_schemas)

        # Assert
        assert len(secret_variables) == 0

    def test_extract_secret_variables_empty_list(self, provider_configuration):
        """Test extracting secret variables from empty credential form schemas"""
        # Arrange
        credential_form_schemas = []

        # Act
        secret_variables = provider_configuration.extract_secret_variables(credential_form_schemas)

        # Assert
        assert len(secret_variables) == 0

    @patch("core.entities.provider_configuration.encrypter")
    def test_obfuscated_credentials_with_secret_variables(self, mock_encrypter, provider_configuration):
        """Test obfuscating credentials with secret variables"""
        # Arrange
        credentials = {
            "api_key": "sk-1234567890abcdef",
            "model_name": "gpt-4",
            "secret_token": "secret_value_123",
            "temperature": "0.7",
        }

        credential_form_schemas = [
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key", zh_Hans="API 密钥"),
                type=FormType.SECRET_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="model_name",
                label=I18nObject(en_US="Model Name", zh_Hans="模型名称"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="secret_token",
                label=I18nObject(en_US="Secret Token", zh_Hans="密钥令牌"),
                type=FormType.SECRET_INPUT,
                required=False,
            ),
            CredentialFormSchema(
                variable="temperature",
                label=I18nObject(en_US="Temperature", zh_Hans="温度"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
        ]

        mock_encrypter.obfuscated_token.side_effect = lambda x: f"***{x[-4:]}"

        # Act
        obfuscated = provider_configuration.obfuscated_credentials(credentials, credential_form_schemas)

        # Assert
        assert obfuscated["api_key"] == "***cdef"
        assert obfuscated["model_name"] == "gpt-4"  # Not obfuscated
        assert obfuscated["secret_token"] == "***_123"
        assert obfuscated["temperature"] == "0.7"  # Not obfuscated

        # Verify encrypter was called for secret fields only
        assert mock_encrypter.obfuscated_token.call_count == 2
        mock_encrypter.obfuscated_token.assert_any_call("sk-1234567890abcdef")
        mock_encrypter.obfuscated_token.assert_any_call("secret_value_123")

    def test_obfuscated_credentials_no_secret_variables(self, provider_configuration):
        """Test obfuscating credentials when no secret variables exist"""
        # Arrange
        credentials = {
            "model_name": "gpt-4",
            "temperature": "0.7",
            "max_tokens": "1000",
        }

        credential_form_schemas = [
            CredentialFormSchema(
                variable="model_name",
                label=I18nObject(en_US="Model Name", zh_Hans="模型名称"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="temperature",
                label=I18nObject(en_US="Temperature", zh_Hans="温度"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="max_tokens",
                label=I18nObject(en_US="Max Tokens", zh_Hans="最大令牌数"),
                type=FormType.TEXT_INPUT,
                required=True,
            ),
        ]

        # Act
        obfuscated = provider_configuration.obfuscated_credentials(credentials, credential_form_schemas)

        # Assert
        assert obfuscated == credentials  # No changes expected

    def test_obfuscated_credentials_empty_credentials(self, provider_configuration):
        """Test obfuscating empty credentials"""
        # Arrange
        credentials = {}
        credential_form_schemas = []

        # Act
        obfuscated = provider_configuration.obfuscated_credentials(credentials, credential_form_schemas)

        # Assert
        assert obfuscated == {}
