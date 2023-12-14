from typing import Optional, List, Dict

from pydantic import BaseModel

from core.entities.provider_entities import SystemConfiguration, CustomConfiguration, SystemConfigurationStatus
from core.helper import encrypter
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ProviderEntity, CredentialFormSchema, FormType
from core.model_runtime.model_providers import model_provider_factory
from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from models.provider import ProviderType


class ProviderConfiguration(BaseModel):
    """
    Model class for provider configuration.
    """
    tenant_id: str
    provider: ProviderEntity
    preferred_provider_type: ProviderType
    system_configuration: SystemConfiguration
    custom_configuration: CustomConfiguration

    def get_current_configuration(self):
        """
        Get current configuration.

        :return:
        """
        if self.preferred_provider_type == ProviderType.SYSTEM:
            return self.system_configuration
        else:
            return self.custom_configuration

    def get_system_configuration_status(self) -> SystemConfigurationStatus:
        """
        Get system configuration status.
        :return:
        """
        if self.system_configuration.enabled is False:
            return SystemConfigurationStatus.UNSUPPORTED

        current_quota_type = self.system_configuration.current_quota_type
        current_quota_configuration = next(
            (q for q in self.system_configuration.quota_configurations if q.quota_type == current_quota_type),
            None
        )

        return SystemConfigurationStatus.ACTIVE if current_quota_configuration.is_valid else \
            SystemConfigurationStatus.QUOTA_EXCEEDED

    def is_custom_configuration_available(self) -> bool:
        """
        Check custom configuration available.
        :return:
        """
        return (self.custom_configuration.provider is not None
                or len(self.custom_configuration.models) > 0)

    def get_custom_credentials(self, obfuscated: bool = False) -> Optional[dict]:
        """
        Get custom credentials.

        :param obfuscated:
        :return:
        """
        if self.custom_configuration.provider is None:
            return None

        credentials = self.custom_configuration.provider.credentials
        if not obfuscated:
            return credentials

        # Get provider credential secret variables
        provider_credential_secret_variables = self._extract_secret_variables(
            self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema else []
        )

        # Obfuscate provider credentials
        copy_credentials = credentials.copy()
        for key, value in copy_credentials.items():
            if key in provider_credential_secret_variables:
                copy_credentials[key] = encrypter.obfuscated_token(value)

        return copy_credentials

    def custom_credentials_validate(self, credentials: dict) -> None:
        """
        Validate custom credentials.
        :param credentials:
        :return:
        """
        model_provider_factory.provider_credentials_validate(
            self.provider.provider,
            credentials
        )

    def add_or_update_custom_credentials(self, credentials: dict) -> None:
        pass

    def delete_custom_credentials(self) -> None:
        pass

    def get_custom_model_credentials(self, model_type: ModelType, model: str, obfuscated: bool = False) \
            -> Optional[dict]:
        pass

    def custom_model_credentials_validate(self, model_type: ModelType, model: str, credentials: dict) -> None:
        pass

    def add_or_update_custom_model_credentials(self, model_type: ModelType, model: str, credentials: dict) -> None:
        pass

    def delete_custom_model_credentials(self, model_type: ModelType, model: str) -> None:
        pass

    def get_provider_instance(self) -> ModelProvider:
        pass

    def switch_preferred_provider_type(self, provider_type: ProviderType) -> None:
        pass

    def _extract_secret_variables(self, credential_form_schemas: list[CredentialFormSchema]) -> list[str]:
        """
        Extract secret input form variables.

        :param credential_form_schemas:
        :return:
        """
        secret_input_form_variables = []
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema.type == FormType.SECRET_INPUT.value:
                secret_input_form_variables.append(credential_form_schema.variable)

        return secret_input_form_variables


class ProviderConfigurations(BaseModel, Dict[str, ProviderConfiguration]):
    """
    Model class for provider configuration dict.
    """
    tenant_id: str

    def get_available_models(self, provider: Optional[str] = None, model_type: Optional[ModelType] = None) -> list:
        pass

    def to_list(self) -> List[ProviderConfiguration]:
        """
        Convert to list.

        :return:
        """
        return list(self.values())
