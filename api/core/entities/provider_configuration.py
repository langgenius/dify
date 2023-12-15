import datetime
import json
from json import JSONDecodeError
from typing import Optional, List, Dict

from pydantic import BaseModel

from core.entities.provider_entities import SystemConfiguration, CustomConfiguration, SystemConfigurationStatus
from core.helper import encrypter
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ProviderEntity, CredentialFormSchema, FormType
from core.model_runtime.model_providers import model_provider_factory
from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from extensions.ext_database import db
from models.provider import ProviderType, Provider, ProviderModel, TenantPreferredModelProvider


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

        :param obfuscated: obfuscated secret data in credentials
        :return:
        """
        if self.custom_configuration.provider is None:
            return None

        credentials = self.custom_configuration.provider.credentials
        if not obfuscated:
            return credentials

        # Obfuscate credentials
        return self._obfuscated_credentials(
            credentials=credentials,
            credential_form_schemas=self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema else []
        )

    def custom_credentials_validate(self, credentials: dict) -> None:
        """
        Validate custom credentials.
        :param credentials: provider credentials
        :return:
        """
        model_provider_factory.provider_credentials_validate(
            self.provider.provider,
            credentials
        )

    def add_or_update_custom_credentials(self, credentials: dict) -> None:
        """
        Add or update custom provider credentials.
        :param credentials:
        :return:
        """
        # validate custom provider config
        self.custom_credentials_validate(credentials)

        # get provider
        provider_record = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == self.tenant_id,
            Provider.provider_name == self.provider.provider,
            Provider.provider_type == ProviderType.CUSTOM.value
        ).first()

        original_credentials = {}
        if provider_record:
            try:
                original_credentials = json.loads(provider_record.encrypted_config)
            except JSONDecodeError:
                original_credentials = {}

        # Get provider credential secret variables
        provider_credential_secret_variables = self._extract_secret_variables(
            self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema else []
        )

        # encrypt credentials
        for key, value in credentials.items():
            if key in provider_credential_secret_variables:
                # if send [__HIDDEN__] in secret input, it will be same as original value
                if value == '[__HIDDEN__]' and key in original_credentials:
                    credentials[key] = original_credentials[key]
                else:
                    credentials[key] = encrypter.encrypt_token(self.tenant_id, value)

        # save provider
        if provider_record:
            provider_record.encrypted_config = json.dumps(credentials)
            provider_record.is_valid = True
            provider_record.updated_at = datetime.datetime.utcnow()
            db.session.commit()
        else:
            provider_record = Provider(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                provider_type=ProviderType.CUSTOM.value,
                encrypted_config=json.dumps(credentials),
                is_valid=True
            )
            db.session.add(provider_record)
            db.session.commit()

    def delete_custom_credentials(self) -> None:
        """
        Delete custom provider credentials.
        :return:
        """
        # get provider
        provider_record = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == self.tenant_id,
            Provider.provider_name == self.provider.provider,
            Provider.provider_type == ProviderType.CUSTOM.value
        ).first()

        # delete provider
        if provider_record:
            self.switch_preferred_provider_type(ProviderType.SYSTEM)

            db.session.delete(provider_record)
            db.session.commit()

    def get_custom_model_credentials(self, model_type: ModelType, model: str, obfuscated: bool = False) \
            -> Optional[dict]:
        """
        Get custom model credentials.

        :param model_type: model type
        :param model: model name
        :param obfuscated: obfuscated secret data in credentials
        :return:
        """
        if not self.custom_configuration.models:
            return None

        for model_configuration in self.custom_configuration.models:
            if model_configuration.model_type == model_type and model_configuration.model == model:
                credentials = model_configuration.credentials
                if not obfuscated:
                    return credentials

                # Obfuscate credentials
                return self._obfuscated_credentials(
                    credentials=credentials,
                    credential_form_schemas=self.provider.model_credential_schema.credential_form_schemas
                    if self.provider.model_credential_schema else []
                )

        return None

    def custom_model_credentials_validate(self, model_type: ModelType, model: str, credentials: dict) -> None:
        """
        Validate custom model credentials.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        model_provider_factory.model_credentials_validate(
            model_type=model_type,
            model=model,
            credentials=credentials
        )

    def add_or_update_custom_model_credentials(self, model_type: ModelType, model: str, credentials: dict) -> None:
        """
        Add or update custom model credentials.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # validate custom model config
        self.custom_model_credentials_validate(model_type, model, credentials)

        # get provider model
        provider_model_record = db.session.query(ProviderModel) \
            .filter(
            ProviderModel.tenant_id == self.tenant_id,
            ProviderModel.provider_name == self.provider.provider,
            ProviderModel.model_name == model,
            ProviderModel.model_type == model_type.to_origin_model_type()
        ).first()

        # Get provider credential secret variables
        provider_credential_secret_variables = self._extract_secret_variables(
            self.provider.model_credential_schema.credential_form_schemas
            if self.provider.model_credential_schema else []
        )

        original_credentials = {}
        if provider_model_record:
            try:
                original_credentials = json.loads(provider_model_record.encrypted_config)
            except JSONDecodeError:
                original_credentials = {}

        # encrypt credentials
        for key, value in credentials.items():
            if key in provider_credential_secret_variables:
                # if send [__HIDDEN__] in secret input, it will be same as original value
                if value == '[__HIDDEN__]' and key in original_credentials:
                    credentials[key] = original_credentials[key]
                else:
                    credentials[key] = encrypter.encrypt_token(self.tenant_id, value)

        # save provider model
        if provider_model_record:
            provider_model_record.encrypted_config = json.dumps(credentials)
            provider_model_record.is_valid = True
            provider_model_record.updated_at = datetime.datetime.utcnow()
            db.session.commit()
        else:
            provider_model_record = ProviderModel(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                model_name=model,
                model_type=model_type,
                encrypted_config=json.dumps(credentials),
                is_valid=True
            )
            db.session.add(provider_model_record)
            db.session.commit()

    def delete_custom_model_credentials(self, model_type: ModelType, model: str) -> None:
        """
        Delete custom model credentials.
        :param model_type: model type
        :param model: model name
        :return:
        """
        # get provider model
        provider_model_record = db.session.query(ProviderModel) \
            .filter(
            ProviderModel.tenant_id == self.tenant_id,
            ProviderModel.provider_name == self.provider.provider,
            ProviderModel.model_name == model,
            ProviderModel.model_type == model_type.to_origin_model_type()
        ).first()

        # delete provider model
        if provider_model_record:
            db.session.delete(provider_model_record)
            db.session.commit()

    def get_provider_instance(self) -> ModelProvider:
        """
        Get provider instance.
        :return:
        """
        return model_provider_factory.get_provider_instance(self.provider.provider)

    def switch_preferred_provider_type(self, provider_type: ProviderType) -> None:
        """
        Switch preferred provider type.
        :param provider_type:
        :return:
        """
        if provider_type == self.preferred_provider_type:
            return

        if provider_type == ProviderType.SYSTEM and not self.system_configuration.enabled:
            return

        # get preferred provider
        preferred_model_provider = db.session.query(TenantPreferredModelProvider) \
            .filter(
            TenantPreferredModelProvider.tenant_id == self.tenant_id,
            TenantPreferredModelProvider.provider_name == self.provider.provider
        ).first()

        if preferred_model_provider:
            preferred_model_provider.preferred_provider_type = provider_type.value
        else:
            preferred_model_provider = TenantPreferredModelProvider(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                preferred_provider_type=provider_type.value
            )
            db.session.add(preferred_model_provider)

        db.session.commit()


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

    def _obfuscated_credentials(self, credentials: dict, credential_form_schemas: list[CredentialFormSchema]) -> dict:
        """
        Obfuscated credentials.

        :param credentials: credentials
        :param credential_form_schemas: credential form schemas
        :return:
        """
        # Get provider credential secret variables
        credential_secret_variables = self._extract_secret_variables(
            credential_form_schemas
        )

        # Obfuscate provider credentials
        copy_credentials = credentials.copy()
        for key, value in copy_credentials.items():
            if key in credential_secret_variables:
                copy_credentials[key] = encrypter.obfuscated_token(value)

        return copy_credentials


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
