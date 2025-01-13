import datetime
import json
import logging
from collections import defaultdict
from collections.abc import Iterator
from json import JSONDecodeError
from typing import Optional

from pydantic import BaseModel, ConfigDict

from constants import HIDDEN_VALUE
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_entities import (
    CustomConfiguration,
    ModelSettings,
    SystemConfiguration,
    SystemConfigurationStatus,
)
from core.helper import encrypter
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.model_runtime.entities.model_entities import FetchFrom, ModelType
from core.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FormType,
    ProviderEntity,
)
from core.model_runtime.model_providers import model_provider_factory
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from extensions.ext_database import db
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderModel,
    ProviderModelSetting,
    ProviderType,
    TenantPreferredModelProvider,
)

logger = logging.getLogger(__name__)

original_provider_configurate_methods: dict[str, list[ConfigurateMethod]] = {}


class ProviderConfiguration(BaseModel):
    """
    Model class for provider configuration.
    """

    tenant_id: str
    provider: ProviderEntity
    preferred_provider_type: ProviderType
    using_provider_type: ProviderType
    system_configuration: SystemConfiguration
    custom_configuration: CustomConfiguration
    model_settings: list[ModelSettings]

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def __init__(self, **data):
        super().__init__(**data)

        if self.provider.provider not in original_provider_configurate_methods:
            original_provider_configurate_methods[self.provider.provider] = []
            for configurate_method in self.provider.configurate_methods:
                original_provider_configurate_methods[self.provider.provider].append(configurate_method)

        if original_provider_configurate_methods[self.provider.provider] == [ConfigurateMethod.CUSTOMIZABLE_MODEL]:
            if (
                any(
                    len(quota_configuration.restrict_models) > 0
                    for quota_configuration in self.system_configuration.quota_configurations
                )
                and ConfigurateMethod.PREDEFINED_MODEL not in self.provider.configurate_methods
            ):
                self.provider.configurate_methods.append(ConfigurateMethod.PREDEFINED_MODEL)

    def get_current_credentials(self, model_type: ModelType, model: str) -> Optional[dict]:
        """
        Get current credentials.

        :param model_type: model type
        :param model: model name
        :return:
        """
        if self.model_settings:
            # check if model is disabled by admin
            for model_setting in self.model_settings:
                if model_setting.model_type == model_type and model_setting.model == model:
                    if not model_setting.enabled:
                        raise ValueError(f"Model {model} is disabled.")

        if self.using_provider_type == ProviderType.SYSTEM:
            restrict_models = []
            for quota_configuration in self.system_configuration.quota_configurations:
                if self.system_configuration.current_quota_type != quota_configuration.quota_type:
                    continue

                restrict_models = quota_configuration.restrict_models
            if self.system_configuration.credentials is None:
                return None
            copy_credentials = self.system_configuration.credentials.copy()
            if restrict_models:
                for restrict_model in restrict_models:
                    if (
                        restrict_model.model_type == model_type
                        and restrict_model.model == model
                        and restrict_model.base_model_name
                    ):
                        copy_credentials["base_model_name"] = restrict_model.base_model_name

            return copy_credentials
        else:
            credentials = None
            if self.custom_configuration.models:
                for model_configuration in self.custom_configuration.models:
                    if model_configuration.model_type == model_type and model_configuration.model == model:
                        credentials = model_configuration.credentials
                        break

            if not credentials and self.custom_configuration.provider:
                credentials = self.custom_configuration.provider.credentials

            return credentials

    def get_system_configuration_status(self) -> Optional[SystemConfigurationStatus]:
        """
        Get system configuration status.
        :return:
        """
        if self.system_configuration.enabled is False:
            return SystemConfigurationStatus.UNSUPPORTED

        current_quota_type = self.system_configuration.current_quota_type
        current_quota_configuration = next(
            (q for q in self.system_configuration.quota_configurations if q.quota_type == current_quota_type), None
        )
        if current_quota_configuration is None:
            return None

        return (
            SystemConfigurationStatus.ACTIVE
            if current_quota_configuration.is_valid
            else SystemConfigurationStatus.QUOTA_EXCEEDED
        )

    def is_custom_configuration_available(self) -> bool:
        """
        Check custom configuration available.
        :return:
        """
        return self.custom_configuration.provider is not None or len(self.custom_configuration.models) > 0

    def get_custom_credentials(self, obfuscated: bool = False):
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
        return self.obfuscated_credentials(
            credentials=credentials,
            credential_form_schemas=self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema
            else [],
        )

    def custom_credentials_validate(self, credentials: dict) -> tuple[Optional[Provider], dict]:
        """
        Validate custom credentials.
        :param credentials: provider credentials
        :return:
        """
        # get provider
        provider_record = (
            db.session.query(Provider)
            .filter(
                Provider.tenant_id == self.tenant_id,
                Provider.provider_name == self.provider.provider,
                Provider.provider_type == ProviderType.CUSTOM.value,
            )
            .first()
        )

        # Get provider credential secret variables
        provider_credential_secret_variables = self.extract_secret_variables(
            self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema
            else []
        )

        if provider_record:
            try:
                # fix origin data
                if provider_record.encrypted_config:
                    if not provider_record.encrypted_config.startswith("{"):
                        original_credentials = {"openai_api_key": provider_record.encrypted_config}
                    else:
                        original_credentials = json.loads(provider_record.encrypted_config)
                else:
                    original_credentials = {}
            except JSONDecodeError:
                original_credentials = {}

            # encrypt credentials
            for key, value in credentials.items():
                if key in provider_credential_secret_variables:
                    # if send [__HIDDEN__] in secret input, it will be same as original value
                    if value == HIDDEN_VALUE and key in original_credentials:
                        credentials[key] = encrypter.decrypt_token(self.tenant_id, original_credentials[key])

        credentials = model_provider_factory.provider_credentials_validate(
            provider=self.provider.provider, credentials=credentials
        )

        for key, value in credentials.items():
            if key in provider_credential_secret_variables:
                credentials[key] = encrypter.encrypt_token(self.tenant_id, value)

        return provider_record, credentials

    def add_or_update_custom_credentials(self, credentials: dict) -> None:
        """
        Add or update custom provider credentials.
        :param credentials:
        :return:
        """
        # validate custom provider config
        provider_record, credentials = self.custom_credentials_validate(credentials)

        # save provider
        # Note: Do not switch the preferred provider, which allows users to use quotas first
        if provider_record:
            provider_record.encrypted_config = json.dumps(credentials)
            provider_record.is_valid = True
            provider_record.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            db.session.commit()
        else:
            provider_record = Provider(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                provider_type=ProviderType.CUSTOM.value,
                encrypted_config=json.dumps(credentials),
                is_valid=True,
            )
            db.session.add(provider_record)
            db.session.commit()

        provider_model_credentials_cache = ProviderCredentialsCache(
            tenant_id=self.tenant_id, identity_id=provider_record.id, cache_type=ProviderCredentialsCacheType.PROVIDER
        )

        provider_model_credentials_cache.delete()

        self.switch_preferred_provider_type(ProviderType.CUSTOM)

    def delete_custom_credentials(self) -> None:
        """
        Delete custom provider credentials.
        :return:
        """
        # get provider
        provider_record = (
            db.session.query(Provider)
            .filter(
                Provider.tenant_id == self.tenant_id,
                Provider.provider_name == self.provider.provider,
                Provider.provider_type == ProviderType.CUSTOM.value,
            )
            .first()
        )

        # delete provider
        if provider_record:
            self.switch_preferred_provider_type(ProviderType.SYSTEM)

            db.session.delete(provider_record)
            db.session.commit()

            provider_model_credentials_cache = ProviderCredentialsCache(
                tenant_id=self.tenant_id,
                identity_id=provider_record.id,
                cache_type=ProviderCredentialsCacheType.PROVIDER,
            )

            provider_model_credentials_cache.delete()

    def get_custom_model_credentials(
        self, model_type: ModelType, model: str, obfuscated: bool = False
    ) -> Optional[dict]:
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
                return self.obfuscated_credentials(
                    credentials=credentials,
                    credential_form_schemas=self.provider.model_credential_schema.credential_form_schemas
                    if self.provider.model_credential_schema
                    else [],
                )

        return None

    def custom_model_credentials_validate(
        self, model_type: ModelType, model: str, credentials: dict
    ) -> tuple[Optional[ProviderModel], dict]:
        """
        Validate custom model credentials.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # get provider model
        provider_model_record = (
            db.session.query(ProviderModel)
            .filter(
                ProviderModel.tenant_id == self.tenant_id,
                ProviderModel.provider_name == self.provider.provider,
                ProviderModel.model_name == model,
                ProviderModel.model_type == model_type.to_origin_model_type(),
            )
            .first()
        )

        # Get provider credential secret variables
        provider_credential_secret_variables = self.extract_secret_variables(
            self.provider.model_credential_schema.credential_form_schemas
            if self.provider.model_credential_schema
            else []
        )

        if provider_model_record:
            try:
                original_credentials = (
                    json.loads(provider_model_record.encrypted_config) if provider_model_record.encrypted_config else {}
                )
            except JSONDecodeError:
                original_credentials = {}

            # decrypt credentials
            for key, value in credentials.items():
                if key in provider_credential_secret_variables:
                    # if send [__HIDDEN__] in secret input, it will be same as original value
                    if value == HIDDEN_VALUE and key in original_credentials:
                        credentials[key] = encrypter.decrypt_token(self.tenant_id, original_credentials[key])

        credentials = model_provider_factory.model_credentials_validate(
            provider=self.provider.provider, model_type=model_type, model=model, credentials=credentials
        )

        for key, value in credentials.items():
            if key in provider_credential_secret_variables:
                credentials[key] = encrypter.encrypt_token(self.tenant_id, value)

        return provider_model_record, credentials

    def add_or_update_custom_model_credentials(self, model_type: ModelType, model: str, credentials: dict) -> None:
        """
        Add or update custom model credentials.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # validate custom model config
        provider_model_record, credentials = self.custom_model_credentials_validate(model_type, model, credentials)

        # save provider model
        # Note: Do not switch the preferred provider, which allows users to use quotas first
        if provider_model_record:
            provider_model_record.encrypted_config = json.dumps(credentials)
            provider_model_record.is_valid = True
            provider_model_record.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            db.session.commit()
        else:
            provider_model_record = ProviderModel(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                model_name=model,
                model_type=model_type.to_origin_model_type(),
                encrypted_config=json.dumps(credentials),
                is_valid=True,
            )
            db.session.add(provider_model_record)
            db.session.commit()

        provider_model_credentials_cache = ProviderCredentialsCache(
            tenant_id=self.tenant_id,
            identity_id=provider_model_record.id,
            cache_type=ProviderCredentialsCacheType.MODEL,
        )

        provider_model_credentials_cache.delete()

    def delete_custom_model_credentials(self, model_type: ModelType, model: str) -> None:
        """
        Delete custom model credentials.
        :param model_type: model type
        :param model: model name
        :return:
        """
        # get provider model
        provider_model_record = (
            db.session.query(ProviderModel)
            .filter(
                ProviderModel.tenant_id == self.tenant_id,
                ProviderModel.provider_name == self.provider.provider,
                ProviderModel.model_name == model,
                ProviderModel.model_type == model_type.to_origin_model_type(),
            )
            .first()
        )

        # delete provider model
        if provider_model_record:
            db.session.delete(provider_model_record)
            db.session.commit()

            provider_model_credentials_cache = ProviderCredentialsCache(
                tenant_id=self.tenant_id,
                identity_id=provider_model_record.id,
                cache_type=ProviderCredentialsCacheType.MODEL,
            )

            provider_model_credentials_cache.delete()

    def enable_model(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Enable model.
        :param model_type: model type
        :param model: model name
        :return:
        """
        model_setting = (
            db.session.query(ProviderModelSetting)
            .filter(
                ProviderModelSetting.tenant_id == self.tenant_id,
                ProviderModelSetting.provider_name == self.provider.provider,
                ProviderModelSetting.model_type == model_type.to_origin_model_type(),
                ProviderModelSetting.model_name == model,
            )
            .first()
        )

        if model_setting:
            model_setting.enabled = True
            model_setting.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            db.session.commit()
        else:
            model_setting = ProviderModelSetting(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                model_type=model_type.to_origin_model_type(),
                model_name=model,
                enabled=True,
            )
            db.session.add(model_setting)
            db.session.commit()

        return model_setting

    def disable_model(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Disable model.
        :param model_type: model type
        :param model: model name
        :return:
        """
        model_setting = (
            db.session.query(ProviderModelSetting)
            .filter(
                ProviderModelSetting.tenant_id == self.tenant_id,
                ProviderModelSetting.provider_name == self.provider.provider,
                ProviderModelSetting.model_type == model_type.to_origin_model_type(),
                ProviderModelSetting.model_name == model,
            )
            .first()
        )

        if model_setting:
            model_setting.enabled = False
            model_setting.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            db.session.commit()
        else:
            model_setting = ProviderModelSetting(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                model_type=model_type.to_origin_model_type(),
                model_name=model,
                enabled=False,
            )
            db.session.add(model_setting)
            db.session.commit()

        return model_setting

    def get_provider_model_setting(self, model_type: ModelType, model: str) -> Optional[ProviderModelSetting]:
        """
        Get provider model setting.
        :param model_type: model type
        :param model: model name
        :return:
        """
        return (
            db.session.query(ProviderModelSetting)
            .filter(
                ProviderModelSetting.tenant_id == self.tenant_id,
                ProviderModelSetting.provider_name == self.provider.provider,
                ProviderModelSetting.model_type == model_type.to_origin_model_type(),
                ProviderModelSetting.model_name == model,
            )
            .first()
        )

    def enable_model_load_balancing(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Enable model load balancing.
        :param model_type: model type
        :param model: model name
        :return:
        """
        load_balancing_config_count = (
            db.session.query(LoadBalancingModelConfig)
            .filter(
                LoadBalancingModelConfig.tenant_id == self.tenant_id,
                LoadBalancingModelConfig.provider_name == self.provider.provider,
                LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
                LoadBalancingModelConfig.model_name == model,
            )
            .count()
        )

        if load_balancing_config_count <= 1:
            raise ValueError("Model load balancing configuration must be more than 1.")

        model_setting = (
            db.session.query(ProviderModelSetting)
            .filter(
                ProviderModelSetting.tenant_id == self.tenant_id,
                ProviderModelSetting.provider_name == self.provider.provider,
                ProviderModelSetting.model_type == model_type.to_origin_model_type(),
                ProviderModelSetting.model_name == model,
            )
            .first()
        )

        if model_setting:
            model_setting.load_balancing_enabled = True
            model_setting.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            db.session.commit()
        else:
            model_setting = ProviderModelSetting(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                model_type=model_type.to_origin_model_type(),
                model_name=model,
                load_balancing_enabled=True,
            )
            db.session.add(model_setting)
            db.session.commit()

        return model_setting

    def disable_model_load_balancing(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Disable model load balancing.
        :param model_type: model type
        :param model: model name
        :return:
        """
        model_setting = (
            db.session.query(ProviderModelSetting)
            .filter(
                ProviderModelSetting.tenant_id == self.tenant_id,
                ProviderModelSetting.provider_name == self.provider.provider,
                ProviderModelSetting.model_type == model_type.to_origin_model_type(),
                ProviderModelSetting.model_name == model,
            )
            .first()
        )

        if model_setting:
            model_setting.load_balancing_enabled = False
            model_setting.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            db.session.commit()
        else:
            model_setting = ProviderModelSetting(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                model_type=model_type.to_origin_model_type(),
                model_name=model,
                load_balancing_enabled=False,
            )
            db.session.add(model_setting)
            db.session.commit()

        return model_setting

    def get_provider_instance(self) -> ModelProvider:
        """
        Get provider instance.
        :return:
        """
        return model_provider_factory.get_provider_instance(self.provider.provider)

    def get_model_type_instance(self, model_type: ModelType) -> AIModel:
        """
        Get current model type instance.

        :param model_type: model type
        :return:
        """
        # Get provider instance
        provider_instance = self.get_provider_instance()

        # Get model instance of LLM
        return provider_instance.get_model_instance(model_type)

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
        preferred_model_provider = (
            db.session.query(TenantPreferredModelProvider)
            .filter(
                TenantPreferredModelProvider.tenant_id == self.tenant_id,
                TenantPreferredModelProvider.provider_name == self.provider.provider,
            )
            .first()
        )

        if preferred_model_provider:
            preferred_model_provider.preferred_provider_type = provider_type.value
        else:
            preferred_model_provider = TenantPreferredModelProvider(
                tenant_id=self.tenant_id,
                provider_name=self.provider.provider,
                preferred_provider_type=provider_type.value,
            )
            db.session.add(preferred_model_provider)

        db.session.commit()

    def extract_secret_variables(self, credential_form_schemas: list[CredentialFormSchema]) -> list[str]:
        """
        Extract secret input form variables.

        :param credential_form_schemas:
        :return:
        """
        secret_input_form_variables = []
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema.type == FormType.SECRET_INPUT:
                secret_input_form_variables.append(credential_form_schema.variable)

        return secret_input_form_variables

    def obfuscated_credentials(self, credentials: dict, credential_form_schemas: list[CredentialFormSchema]) -> dict:
        """
        Obfuscated credentials.

        :param credentials: credentials
        :param credential_form_schemas: credential form schemas
        :return:
        """
        # Get provider credential secret variables
        credential_secret_variables = self.extract_secret_variables(credential_form_schemas)

        # Obfuscate provider credentials
        copy_credentials = credentials.copy()
        for key, value in copy_credentials.items():
            if key in credential_secret_variables:
                copy_credentials[key] = encrypter.obfuscated_token(value)

        return copy_credentials

    def get_provider_model(
        self, model_type: ModelType, model: str, only_active: bool = False
    ) -> Optional[ModelWithProviderEntity]:
        """
        Get provider model.
        :param model_type: model type
        :param model: model name
        :param only_active: return active model only
        :return:
        """
        provider_models = self.get_provider_models(model_type, only_active)

        for provider_model in provider_models:
            if provider_model.model == model:
                return provider_model

        return None

    def get_provider_models(
        self, model_type: Optional[ModelType] = None, only_active: bool = False
    ) -> list[ModelWithProviderEntity]:
        """
        Get provider models.
        :param model_type: model type
        :param only_active: only active models
        :return:
        """
        provider_instance = self.get_provider_instance()

        model_types = []
        if model_type:
            model_types.append(model_type)
        else:
            model_types = list(provider_instance.get_provider_schema().supported_model_types)

        # Group model settings by model type and model
        model_setting_map: defaultdict[ModelType, dict[str, ModelSettings]] = defaultdict(dict)
        for model_setting in self.model_settings:
            model_setting_map[model_setting.model_type][model_setting.model] = model_setting

        if self.using_provider_type == ProviderType.SYSTEM:
            provider_models = self._get_system_provider_models(
                model_types=model_types, provider_instance=provider_instance, model_setting_map=model_setting_map
            )
        else:
            provider_models = self._get_custom_provider_models(
                model_types=model_types, provider_instance=provider_instance, model_setting_map=model_setting_map
            )

        if only_active:
            provider_models = [m for m in provider_models if m.status == ModelStatus.ACTIVE]

        # resort provider_models
        return sorted(provider_models, key=lambda x: x.model_type.value)

    def _get_system_provider_models(
        self,
        model_types: list[ModelType],
        provider_instance: ModelProvider,
        model_setting_map: dict[ModelType, dict[str, ModelSettings]],
    ) -> list[ModelWithProviderEntity]:
        """
        Get system provider models.

        :param model_types: model types
        :param provider_instance: provider instance
        :param model_setting_map: model setting map
        :return:
        """
        provider_models = []
        for model_type in model_types:
            for m in provider_instance.models(model_type):
                status = ModelStatus.ACTIVE
                if m.model_type in model_setting_map and m.model in model_setting_map[m.model_type]:
                    model_setting = model_setting_map[m.model_type][m.model]
                    if model_setting.enabled is False:
                        status = ModelStatus.DISABLED

                provider_models.append(
                    ModelWithProviderEntity(
                        model=m.model,
                        label=m.label,
                        model_type=m.model_type,
                        features=m.features,
                        fetch_from=m.fetch_from,
                        model_properties=m.model_properties,
                        deprecated=m.deprecated,
                        provider=SimpleModelProviderEntity(self.provider),
                        status=status,
                    )
                )

        if self.provider.provider not in original_provider_configurate_methods:
            original_provider_configurate_methods[self.provider.provider] = []
            for configurate_method in provider_instance.get_provider_schema().configurate_methods:
                original_provider_configurate_methods[self.provider.provider].append(configurate_method)

        should_use_custom_model = False
        if original_provider_configurate_methods[self.provider.provider] == [ConfigurateMethod.CUSTOMIZABLE_MODEL]:
            should_use_custom_model = True

        for quota_configuration in self.system_configuration.quota_configurations:
            if self.system_configuration.current_quota_type != quota_configuration.quota_type:
                continue

            restrict_models = quota_configuration.restrict_models
            if len(restrict_models) == 0:
                break

            if should_use_custom_model:
                if original_provider_configurate_methods[self.provider.provider] == [
                    ConfigurateMethod.CUSTOMIZABLE_MODEL
                ]:
                    # only customizable model
                    for restrict_model in restrict_models:
                        if self.system_configuration.credentials is not None:
                            copy_credentials = self.system_configuration.credentials.copy()
                            if restrict_model.base_model_name:
                                copy_credentials["base_model_name"] = restrict_model.base_model_name

                            try:
                                custom_model_schema = provider_instance.get_model_instance(
                                    restrict_model.model_type
                                ).get_customizable_model_schema_from_credentials(restrict_model.model, copy_credentials)
                            except Exception as ex:
                                logger.warning(f"get custom model schema failed, {ex}")
                                continue

                            if not custom_model_schema:
                                continue

                            if custom_model_schema.model_type not in model_types:
                                continue

                            status = ModelStatus.ACTIVE
                            if (
                                custom_model_schema.model_type in model_setting_map
                                and custom_model_schema.model in model_setting_map[custom_model_schema.model_type]
                            ):
                                model_setting = model_setting_map[custom_model_schema.model_type][
                                    custom_model_schema.model
                                ]
                                if model_setting.enabled is False:
                                    status = ModelStatus.DISABLED

                            provider_models.append(
                                ModelWithProviderEntity(
                                    model=custom_model_schema.model,
                                    label=custom_model_schema.label,
                                    model_type=custom_model_schema.model_type,
                                    features=custom_model_schema.features,
                                    fetch_from=FetchFrom.PREDEFINED_MODEL,
                                    model_properties=custom_model_schema.model_properties,
                                    deprecated=custom_model_schema.deprecated,
                                    provider=SimpleModelProviderEntity(self.provider),
                                    status=status,
                                )
                            )

            # if llm name not in restricted llm list, remove it
            restrict_model_names = [rm.model for rm in restrict_models]
            for model in provider_models:
                if model.model_type == ModelType.LLM and model.model not in restrict_model_names:
                    model.status = ModelStatus.NO_PERMISSION
                elif not quota_configuration.is_valid:
                    model.status = ModelStatus.QUOTA_EXCEEDED

        return provider_models

    def _get_custom_provider_models(
        self,
        model_types: list[ModelType],
        provider_instance: ModelProvider,
        model_setting_map: dict[ModelType, dict[str, ModelSettings]],
    ) -> list[ModelWithProviderEntity]:
        """
        Get custom provider models.

        :param model_types: model types
        :param provider_instance: provider instance
        :param model_setting_map: model setting map
        :return:
        """
        provider_models = []

        credentials = None
        if self.custom_configuration.provider:
            credentials = self.custom_configuration.provider.credentials

        for model_type in model_types:
            if model_type not in self.provider.supported_model_types:
                continue

            models = provider_instance.models(model_type)
            for m in models:
                status = ModelStatus.ACTIVE if credentials else ModelStatus.NO_CONFIGURE
                load_balancing_enabled = False
                if m.model_type in model_setting_map and m.model in model_setting_map[m.model_type]:
                    model_setting = model_setting_map[m.model_type][m.model]
                    if model_setting.enabled is False:
                        status = ModelStatus.DISABLED

                    if len(model_setting.load_balancing_configs) > 1:
                        load_balancing_enabled = True

                provider_models.append(
                    ModelWithProviderEntity(
                        model=m.model,
                        label=m.label,
                        model_type=m.model_type,
                        features=m.features,
                        fetch_from=m.fetch_from,
                        model_properties=m.model_properties,
                        deprecated=m.deprecated,
                        provider=SimpleModelProviderEntity(self.provider),
                        status=status,
                        load_balancing_enabled=load_balancing_enabled,
                    )
                )

        # custom models
        for model_configuration in self.custom_configuration.models:
            if model_configuration.model_type not in model_types:
                continue

            try:
                custom_model_schema = provider_instance.get_model_instance(
                    model_configuration.model_type
                ).get_customizable_model_schema_from_credentials(
                    model_configuration.model, model_configuration.credentials
                )
            except Exception as ex:
                logger.warning(f"get custom model schema failed, {ex}")
                continue

            if not custom_model_schema:
                continue

            status = ModelStatus.ACTIVE
            load_balancing_enabled = False
            if (
                custom_model_schema.model_type in model_setting_map
                and custom_model_schema.model in model_setting_map[custom_model_schema.model_type]
            ):
                model_setting = model_setting_map[custom_model_schema.model_type][custom_model_schema.model]
                if model_setting.enabled is False:
                    status = ModelStatus.DISABLED

                if len(model_setting.load_balancing_configs) > 1:
                    load_balancing_enabled = True

            provider_models.append(
                ModelWithProviderEntity(
                    model=custom_model_schema.model,
                    label=custom_model_schema.label,
                    model_type=custom_model_schema.model_type,
                    features=custom_model_schema.features,
                    fetch_from=custom_model_schema.fetch_from,
                    model_properties=custom_model_schema.model_properties,
                    deprecated=custom_model_schema.deprecated,
                    provider=SimpleModelProviderEntity(self.provider),
                    status=status,
                    load_balancing_enabled=load_balancing_enabled,
                )
            )

        return provider_models


class ProviderConfigurations(BaseModel):
    """
    Model class for provider configuration dict.
    """

    tenant_id: str
    configurations: dict[str, ProviderConfiguration] = {}

    def __init__(self, tenant_id: str):
        super().__init__(tenant_id=tenant_id)

    def get_models(
        self, provider: Optional[str] = None, model_type: Optional[ModelType] = None, only_active: bool = False
    ) -> list[ModelWithProviderEntity]:
        """
        Get available models.

        If preferred provider type is `system`:
          Get the current **system mode** if provider supported,
          if all system modes are not available (no quota), it is considered to be the **custom credential mode**.
          If there is no model configured in custom mode, it is treated as no_configure.
        system > custom > no_configure

        If preferred provider type is `custom`:
          If custom credentials are configured, it is treated as custom mode.
          Otherwise, get the current **system mode** if supported,
          If all system modes are not available (no quota), it is treated as no_configure.
        custom > system > no_configure

        If real mode is `system`, use system credentials to get models,
          paid quotas > provider free quotas > system free quotas
          include pre-defined models (exclude GPT-4, status marked as `no_permission`).
        If real mode is `custom`, use workspace custom credentials to get models,
          include pre-defined models, custom models(manual append).
        If real mode is `no_configure`, only return pre-defined models from `model runtime`.
          (model status marked as `no_configure` if preferred provider type is `custom` otherwise `quota_exceeded`)
        model status marked as `active` is available.

        :param provider: provider name
        :param model_type: model type
        :param only_active: only active models
        :return:
        """
        all_models = []
        for provider_configuration in self.values():
            if provider and provider_configuration.provider.provider != provider:
                continue

            all_models.extend(provider_configuration.get_provider_models(model_type, only_active))

        return all_models

    def to_list(self) -> list[ProviderConfiguration]:
        """
        Convert to list.

        :return:
        """
        return list(self.values())

    def __getitem__(self, key):
        return self.configurations[key]

    def __setitem__(self, key, value):
        self.configurations[key] = value

    def __iter__(self):
        return iter(self.configurations)

    def values(self) -> Iterator[ProviderConfiguration]:
        return iter(self.configurations.values())

    def get(self, key, default=None):
        return self.configurations.get(key, default)


class ProviderModelBundle(BaseModel):
    """
    Provider model bundle.
    """

    configuration: ProviderConfiguration
    provider_instance: ModelProvider
    model_type_instance: AIModel

    # pydantic configs
    model_config = ConfigDict(arbitrary_types_allowed=True, protected_namespaces=())
