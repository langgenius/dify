from typing import Optional, List, Dict

from pydantic import BaseModel

from core.entities.provider_entities import SystemConfiguration, CustomConfiguration, SystemConfigurationStatus
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ProviderEntity
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
        pass

    def get_system_configuration_status(self) -> SystemConfigurationStatus:
        pass

    def is_custom_configuration_available(self) -> bool:
        pass

    def fix_missing_system_provider_records(self) -> None:
        pass

    def get_custom_credentials(self, obfuscated: bool = False) -> Optional[dict]:
        pass

    def custom_credentials_validate(self, credentials: dict) -> None:
        pass

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
