import json
from collections import defaultdict
from json import JSONDecodeError
from typing import Optional

from sqlalchemy.exc import IntegrityError

from core.entities.model_entities import DefaultModelEntity, DefaultModelProviderEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations, ProviderModelBundle
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomModelConfiguration,
    CustomProviderConfiguration,
    ModelLoadBalancingConfiguration,
    ModelSettings,
    QuotaConfiguration,
    SystemConfiguration,
)
from core.helper import encrypter
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import (
    CredentialFormSchema,
    FormType,
    ProviderEntity,
)
from core.model_runtime.model_providers import model_provider_factory
from extensions import ext_hosting_provider
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderModel,
    ProviderModelSetting,
    ProviderQuotaType,
    ProviderType,
    TenantDefaultModel,
    TenantPreferredModelProvider,
)
from services.feature_service import FeatureService


class ProviderManager:
    """
    ProviderManager is a class that manages the model providers includes Hosting and Customize Model Providers.
    """
    def __init__(self) -> None:
        self.decoding_rsa_key = None
        self.decoding_cipher_rsa = None

    def get_configurations(self, tenant_id: str) -> ProviderConfigurations:
        """
        Get model provider configurations.

        Construct ProviderConfiguration objects for each provider
        Including:
        1. Basic information of the provider
        2. Hosting configuration information, including:
          (1. Whether to enable (support) hosting type, if enabled, the following information exists
          (2. List of hosting type provider configurations
              (including quota type, quota limit, current remaining quota, etc.)
          (3. The current hosting type in use (whether there is a quota or not)
              paid quotas > provider free quotas > hosting trial quotas
          (4. Unified credentials for hosting providers
        3. Custom configuration information, including:
          (1. Whether to enable (support) custom type, if enabled, the following information exists
          (2. Custom provider configuration (including credentials)
          (3. List of custom provider model configurations (including credentials)
        4. Hosting/custom preferred provider type.
        Provide methods:
        - Get the current configuration (including credentials)
        - Get the availability and status of the hosting configuration: active available,
          quota_exceeded insufficient quota, unsupported hosting
        - Get the availability of custom configuration
          Custom provider available conditions:
          (1. custom provider credentials available
          (2. at least one custom model credentials available
        - Verify, update, and delete custom provider configuration
        - Verify, update, and delete custom provider model configuration
        - Get the list of available models (optional provider filtering, model type filtering)
          Append custom provider models to the list
        - Get provider instance
        - Switch selection priority

        :param tenant_id:
        :return:
        """
        # Get all provider records of the workspace
        provider_name_to_provider_records_dict = self._get_all_providers(tenant_id)

        # Initialize trial provider records if not exist
        provider_name_to_provider_records_dict = self._init_trial_provider_records(
            tenant_id,
            provider_name_to_provider_records_dict
        )

        # Get all provider model records of the workspace
        provider_name_to_provider_model_records_dict = self._get_all_provider_models(tenant_id)

        # Get all provider entities
        provider_entities = model_provider_factory.get_providers()

        # Get All preferred provider types of the workspace
        provider_name_to_preferred_model_provider_records_dict = self._get_all_preferred_model_providers(tenant_id)

        # Get All provider model settings
        provider_name_to_provider_model_settings_dict = self._get_all_provider_model_settings(tenant_id)

        # Get All load balancing configs
        provider_name_to_provider_load_balancing_model_configs_dict \
            = self._get_all_provider_load_balancing_configs(tenant_id)

        provider_configurations = ProviderConfigurations(
            tenant_id=tenant_id
        )

        # Construct ProviderConfiguration objects for each provider
        for provider_entity in provider_entities:
            provider_name = provider_entity.provider
            provider_records = provider_name_to_provider_records_dict.get(provider_entity.provider, [])
            provider_model_records = provider_name_to_provider_model_records_dict.get(provider_entity.provider, [])

            # Convert to custom configuration
            custom_configuration = self._to_custom_configuration(
                tenant_id,
                provider_entity,
                provider_records,
                provider_model_records
            )

            # Convert to system configuration
            system_configuration = self._to_system_configuration(
                tenant_id,
                provider_entity,
                provider_records
            )

            # Get preferred provider type
            preferred_provider_type_record = provider_name_to_preferred_model_provider_records_dict.get(provider_name)

            if preferred_provider_type_record:
                preferred_provider_type = ProviderType.value_of(preferred_provider_type_record.preferred_provider_type)
            elif custom_configuration.provider or custom_configuration.models:
                preferred_provider_type = ProviderType.CUSTOM
            elif system_configuration.enabled:
                preferred_provider_type = ProviderType.SYSTEM
            else:
                preferred_provider_type = ProviderType.CUSTOM

            using_provider_type = preferred_provider_type
            has_valid_quota = any(quota_conf.is_valid for quota_conf in system_configuration.quota_configurations)

            if preferred_provider_type == ProviderType.SYSTEM:
                if not system_configuration.enabled or not has_valid_quota:
                    using_provider_type = ProviderType.CUSTOM

            else:
                if not custom_configuration.provider and not custom_configuration.models:
                    if system_configuration.enabled and has_valid_quota:
                        using_provider_type = ProviderType.SYSTEM

            # Get provider load balancing configs
            provider_model_settings = provider_name_to_provider_model_settings_dict.get(provider_name)

            # Get provider load balancing configs
            provider_load_balancing_configs \
                = provider_name_to_provider_load_balancing_model_configs_dict.get(provider_name)

            # Convert to model settings
            model_settings = self._to_model_settings(
                provider_entity=provider_entity,
                provider_model_settings=provider_model_settings,
                load_balancing_model_configs=provider_load_balancing_configs
            )

            provider_configuration = ProviderConfiguration(
                tenant_id=tenant_id,
                provider=provider_entity,
                preferred_provider_type=preferred_provider_type,
                using_provider_type=using_provider_type,
                system_configuration=system_configuration,
                custom_configuration=custom_configuration,
                model_settings=model_settings
            )

            provider_configurations[provider_name] = provider_configuration

        # Return the encapsulated object
        return provider_configurations

    def get_provider_model_bundle(self, tenant_id: str, provider: str, model_type: ModelType) -> ProviderModelBundle:
        """
        Get provider model bundle.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :return:
        """
        provider_configurations = self.get_configurations(tenant_id)

        # get provider instance
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        provider_instance = provider_configuration.get_provider_instance()
        model_type_instance = provider_instance.get_model_instance(model_type)

        return ProviderModelBundle(
            configuration=provider_configuration,
            provider_instance=provider_instance,
            model_type_instance=model_type_instance
        )

    def get_default_model(self, tenant_id: str, model_type: ModelType) -> Optional[DefaultModelEntity]:
        """
        Get default model.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get the corresponding TenantDefaultModel record
        default_model = db.session.query(TenantDefaultModel) \
            .filter(
            TenantDefaultModel.tenant_id == tenant_id,
            TenantDefaultModel.model_type == model_type.to_origin_model_type()
        ).first()

        # If it does not exist, get the first available provider model from get_configurations
        # and update the TenantDefaultModel record
        if not default_model:
            # Get provider configurations
            provider_configurations = self.get_configurations(tenant_id)

            # get available models from provider_configurations
            available_models = provider_configurations.get_models(
                model_type=model_type,
                only_active=True
            )

            if available_models:
                available_model = next((model for model in available_models if model.model == "gpt-4"),
                                       available_models[0])

                default_model = TenantDefaultModel(
                    tenant_id=tenant_id,
                    model_type=model_type.to_origin_model_type(),
                    provider_name=available_model.provider.provider,
                    model_name=available_model.model
                )
                db.session.add(default_model)
                db.session.commit()

        if not default_model:
            return None

        provider_instance = model_provider_factory.get_provider_instance(default_model.provider_name)
        provider_schema = provider_instance.get_provider_schema()

        return DefaultModelEntity(
            model=default_model.model_name,
            model_type=model_type,
            provider=DefaultModelProviderEntity(
                provider=provider_schema.provider,
                label=provider_schema.label,
                icon_small=provider_schema.icon_small,
                icon_large=provider_schema.icon_large,
                supported_model_types=provider_schema.supported_model_types
            )
        )

    def update_default_model_record(self, tenant_id: str, model_type: ModelType, provider: str, model: str) \
            -> TenantDefaultModel:
        """
        Update default model record.

        :param tenant_id: workspace id
        :param model_type: model type
        :param provider: provider name
        :param model: model name
        :return:
        """
        provider_configurations = self.get_configurations(tenant_id)
        if provider not in provider_configurations:
            raise ValueError(f"Provider {provider} does not exist.")

        # get available models from provider_configurations
        available_models = provider_configurations.get_models(
            model_type=model_type,
            only_active=True
        )

        # check if the model is exist in available models
        model_names = [model.model for model in available_models]
        if model not in model_names:
            raise ValueError(f"Model {model} does not exist.")

        # Get the list of available models from get_configurations and check if it is LLM
        default_model = db.session.query(TenantDefaultModel) \
            .filter(
            TenantDefaultModel.tenant_id == tenant_id,
            TenantDefaultModel.model_type == model_type.to_origin_model_type()
        ).first()

        # create or update TenantDefaultModel record
        if default_model:
            # update default model
            default_model.provider_name = provider
            default_model.model_name = model
            db.session.commit()
        else:
            # create default model
            default_model = TenantDefaultModel(
                tenant_id=tenant_id,
                model_type=model_type.value,
                provider_name=provider,
                model_name=model,
            )
            db.session.add(default_model)
            db.session.commit()

        return default_model

    def _get_all_providers(self, tenant_id: str) -> dict[str, list[Provider]]:
        """
        Get all provider records of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        providers = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == tenant_id,
            Provider.is_valid == True
        ).all()

        provider_name_to_provider_records_dict = defaultdict(list)
        for provider in providers:
            provider_name_to_provider_records_dict[provider.provider_name].append(provider)

        return provider_name_to_provider_records_dict

    def _get_all_provider_models(self, tenant_id: str) -> dict[str, list[ProviderModel]]:
        """
        Get all provider model records of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        # Get all provider model records of the workspace
        provider_models = db.session.query(ProviderModel) \
            .filter(
            ProviderModel.tenant_id == tenant_id,
            ProviderModel.is_valid == True
        ).all()

        provider_name_to_provider_model_records_dict = defaultdict(list)
        for provider_model in provider_models:
            provider_name_to_provider_model_records_dict[provider_model.provider_name].append(provider_model)

        return provider_name_to_provider_model_records_dict

    def _get_all_preferred_model_providers(self, tenant_id: str) -> dict[str, TenantPreferredModelProvider]:
        """
        Get All preferred provider types of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        preferred_provider_types = db.session.query(TenantPreferredModelProvider) \
            .filter(
            TenantPreferredModelProvider.tenant_id == tenant_id
        ).all()

        provider_name_to_preferred_provider_type_records_dict = {
            preferred_provider_type.provider_name: preferred_provider_type
            for preferred_provider_type in preferred_provider_types
        }

        return provider_name_to_preferred_provider_type_records_dict

    def _get_all_provider_model_settings(self, tenant_id: str) -> dict[str, list[ProviderModelSetting]]:
        """
        Get All provider model settings of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        provider_model_settings = db.session.query(ProviderModelSetting) \
            .filter(
            ProviderModelSetting.tenant_id == tenant_id
        ).all()

        provider_name_to_provider_model_settings_dict = defaultdict(list)
        for provider_model_setting in provider_model_settings:
            (provider_name_to_provider_model_settings_dict[provider_model_setting.provider_name]
             .append(provider_model_setting))

        return provider_name_to_provider_model_settings_dict

    def _get_all_provider_load_balancing_configs(self, tenant_id: str) -> dict[str, list[LoadBalancingModelConfig]]:
        """
        Get All provider load balancing configs of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        cache_key = f"tenant:{tenant_id}:model_load_balancing_enabled"
        cache_result = redis_client.get(cache_key)
        if cache_result is None:
            model_load_balancing_enabled = FeatureService.get_features(tenant_id).model_load_balancing_enabled
            redis_client.setex(cache_key, 120, str(model_load_balancing_enabled))
        else:
            cache_result = cache_result.decode('utf-8')
            model_load_balancing_enabled = cache_result == 'True'

        if not model_load_balancing_enabled:
            return dict()

        provider_load_balancing_configs = db.session.query(LoadBalancingModelConfig) \
            .filter(
            LoadBalancingModelConfig.tenant_id == tenant_id
        ).all()

        provider_name_to_provider_load_balancing_model_configs_dict = defaultdict(list)
        for provider_load_balancing_config in provider_load_balancing_configs:
            (provider_name_to_provider_load_balancing_model_configs_dict[provider_load_balancing_config.provider_name]
             .append(provider_load_balancing_config))

        return provider_name_to_provider_load_balancing_model_configs_dict

    def _init_trial_provider_records(self, tenant_id: str,
                                     provider_name_to_provider_records_dict: dict[str, list]) -> dict[str, list]:
        """
        Initialize trial provider records if not exists.

        :param tenant_id: workspace id
        :param provider_name_to_provider_records_dict: provider name to provider records dict
        :return:
        """
        # Get hosting configuration
        hosting_configuration = ext_hosting_provider.hosting_configuration

        for provider_name, configuration in hosting_configuration.provider_map.items():
            if not configuration.enabled:
                continue

            provider_records = provider_name_to_provider_records_dict.get(provider_name)
            if not provider_records:
                provider_records = []

            provider_quota_to_provider_record_dict = dict()
            for provider_record in provider_records:
                if provider_record.provider_type != ProviderType.SYSTEM.value:
                    continue

                provider_quota_to_provider_record_dict[ProviderQuotaType.value_of(provider_record.quota_type)] \
                    = provider_record

            for quota in configuration.quotas:
                if quota.quota_type == ProviderQuotaType.TRIAL:
                    # Init trial provider records if not exists
                    if ProviderQuotaType.TRIAL not in provider_quota_to_provider_record_dict:
                        try:
                            provider_record = Provider(
                                tenant_id=tenant_id,
                                provider_name=provider_name,
                                provider_type=ProviderType.SYSTEM.value,
                                quota_type=ProviderQuotaType.TRIAL.value,
                                quota_limit=quota.quota_limit,
                                quota_used=0,
                                is_valid=True
                            )
                            db.session.add(provider_record)
                            db.session.commit()
                        except IntegrityError:
                            db.session.rollback()
                            provider_record = db.session.query(Provider) \
                                .filter(
                                Provider.tenant_id == tenant_id,
                                Provider.provider_name == provider_name,
                                Provider.provider_type == ProviderType.SYSTEM.value,
                                Provider.quota_type == ProviderQuotaType.TRIAL.value
                            ).first()

                            if provider_record and not provider_record.is_valid:
                                provider_record.is_valid = True
                                db.session.commit()

                        provider_name_to_provider_records_dict[provider_name].append(provider_record)

        return provider_name_to_provider_records_dict

    def _to_custom_configuration(self,
                                 tenant_id: str,
                                 provider_entity: ProviderEntity,
                                 provider_records: list[Provider],
                                 provider_model_records: list[ProviderModel]) -> CustomConfiguration:
        """
        Convert to custom configuration.

        :param tenant_id: workspace id
        :param provider_entity: provider entity
        :param provider_records: provider records
        :param provider_model_records: provider model records
        :return:
        """
        # Get provider credential secret variables
        provider_credential_secret_variables = self._extract_secret_variables(
            provider_entity.provider_credential_schema.credential_form_schemas
            if provider_entity.provider_credential_schema else []
        )

        # Get custom provider record
        custom_provider_record = None
        for provider_record in provider_records:
            if provider_record.provider_type == ProviderType.SYSTEM.value:
                continue

            if not provider_record.encrypted_config:
                continue

            custom_provider_record = provider_record

        # Get custom provider credentials
        custom_provider_configuration = None
        if custom_provider_record:
            provider_credentials_cache = ProviderCredentialsCache(
                tenant_id=tenant_id,
                identity_id=custom_provider_record.id,
                cache_type=ProviderCredentialsCacheType.PROVIDER
            )

            # Get cached provider credentials
            cached_provider_credentials = provider_credentials_cache.get()

            if not cached_provider_credentials:
                try:
                    # fix origin data
                    if (custom_provider_record.encrypted_config
                            and not custom_provider_record.encrypted_config.startswith("{")):
                        provider_credentials = {
                            "openai_api_key": custom_provider_record.encrypted_config
                        }
                    else:
                        provider_credentials = json.loads(custom_provider_record.encrypted_config)
                except JSONDecodeError:
                    provider_credentials = {}

                # Get decoding rsa key and cipher for decrypting credentials
                if self.decoding_rsa_key is None or self.decoding_cipher_rsa is None:
                    self.decoding_rsa_key, self.decoding_cipher_rsa = encrypter.get_decrypt_decoding(tenant_id)

                for variable in provider_credential_secret_variables:
                    if variable in provider_credentials:
                        try:
                            provider_credentials[variable] = encrypter.decrypt_token_with_decoding(
                                provider_credentials.get(variable),
                                self.decoding_rsa_key,
                                self.decoding_cipher_rsa
                            )
                        except ValueError:
                            pass

                # cache provider credentials
                provider_credentials_cache.set(
                    credentials=provider_credentials
                )
            else:
                provider_credentials = cached_provider_credentials

            custom_provider_configuration = CustomProviderConfiguration(
                credentials=provider_credentials
            )

        # Get provider model credential secret variables
        model_credential_secret_variables = self._extract_secret_variables(
            provider_entity.model_credential_schema.credential_form_schemas
            if provider_entity.model_credential_schema else []
        )

        # Get custom provider model credentials
        custom_model_configurations = []
        for provider_model_record in provider_model_records:
            if not provider_model_record.encrypted_config:
                continue

            provider_model_credentials_cache = ProviderCredentialsCache(
                tenant_id=tenant_id,
                identity_id=provider_model_record.id,
                cache_type=ProviderCredentialsCacheType.MODEL
            )

            # Get cached provider model credentials
            cached_provider_model_credentials = provider_model_credentials_cache.get()

            if not cached_provider_model_credentials:
                try:
                    provider_model_credentials = json.loads(provider_model_record.encrypted_config)
                except JSONDecodeError:
                    continue

                # Get decoding rsa key and cipher for decrypting credentials
                if self.decoding_rsa_key is None or self.decoding_cipher_rsa is None:
                    self.decoding_rsa_key, self.decoding_cipher_rsa = encrypter.get_decrypt_decoding(tenant_id)

                for variable in model_credential_secret_variables:
                    if variable in provider_model_credentials:
                        try:
                            provider_model_credentials[variable] = encrypter.decrypt_token_with_decoding(
                                provider_model_credentials.get(variable),
                                self.decoding_rsa_key,
                                self.decoding_cipher_rsa
                            )
                        except ValueError:
                            pass

                # cache provider model credentials
                provider_model_credentials_cache.set(
                    credentials=provider_model_credentials
                )
            else:
                provider_model_credentials = cached_provider_model_credentials

            custom_model_configurations.append(
                CustomModelConfiguration(
                    model=provider_model_record.model_name,
                    model_type=ModelType.value_of(provider_model_record.model_type),
                    credentials=provider_model_credentials
                )
            )

        return CustomConfiguration(
            provider=custom_provider_configuration,
            models=custom_model_configurations
        )

    def _to_system_configuration(self,
                                 tenant_id: str,
                                 provider_entity: ProviderEntity,
                                 provider_records: list[Provider]) -> SystemConfiguration:
        """
        Convert to system configuration.

        :param tenant_id: workspace id
        :param provider_entity: provider entity
        :param provider_records: provider records
        :return:
        """
        # Get hosting configuration
        hosting_configuration = ext_hosting_provider.hosting_configuration

        if provider_entity.provider not in hosting_configuration.provider_map \
                or not hosting_configuration.provider_map.get(provider_entity.provider).enabled:
            return SystemConfiguration(
                enabled=False
            )

        provider_hosting_configuration = hosting_configuration.provider_map.get(provider_entity.provider)

        # Convert provider_records to dict
        quota_type_to_provider_records_dict = dict()
        for provider_record in provider_records:
            if provider_record.provider_type != ProviderType.SYSTEM.value:
                continue

            quota_type_to_provider_records_dict[ProviderQuotaType.value_of(provider_record.quota_type)] \
                = provider_record

        quota_configurations = []
        for provider_quota in provider_hosting_configuration.quotas:
            if provider_quota.quota_type not in quota_type_to_provider_records_dict:
                if provider_quota.quota_type == ProviderQuotaType.FREE:
                    quota_configuration = QuotaConfiguration(
                        quota_type=provider_quota.quota_type,
                        quota_unit=provider_hosting_configuration.quota_unit,
                        quota_used=0,
                        quota_limit=0,
                        is_valid=False,
                        restrict_models=provider_quota.restrict_models
                    )
                else:
                    continue
            else:
                provider_record = quota_type_to_provider_records_dict[provider_quota.quota_type]

                quota_configuration = QuotaConfiguration(
                    quota_type=provider_quota.quota_type,
                    quota_unit=provider_hosting_configuration.quota_unit,
                    quota_used=provider_record.quota_used,
                    quota_limit=provider_record.quota_limit,
                    is_valid=provider_record.quota_limit > provider_record.quota_used or provider_record.quota_limit == -1,
                    restrict_models=provider_quota.restrict_models
                )

            quota_configurations.append(quota_configuration)

        if len(quota_configurations) == 0:
            return SystemConfiguration(
                enabled=False
            )

        current_quota_type = self._choice_current_using_quota_type(quota_configurations)

        current_using_credentials = provider_hosting_configuration.credentials
        if current_quota_type == ProviderQuotaType.FREE:
            provider_record = quota_type_to_provider_records_dict.get(current_quota_type)

            if provider_record:
                provider_credentials_cache = ProviderCredentialsCache(
                    tenant_id=tenant_id,
                    identity_id=provider_record.id,
                    cache_type=ProviderCredentialsCacheType.PROVIDER
                )

                # Get cached provider credentials
                cached_provider_credentials = provider_credentials_cache.get()

                if not cached_provider_credentials:
                    try:
                        provider_credentials = json.loads(provider_record.encrypted_config)
                    except JSONDecodeError:
                        provider_credentials = {}

                    # Get provider credential secret variables
                    provider_credential_secret_variables = self._extract_secret_variables(
                        provider_entity.provider_credential_schema.credential_form_schemas
                        if provider_entity.provider_credential_schema else []
                    )

                    # Get decoding rsa key and cipher for decrypting credentials
                    if self.decoding_rsa_key is None or self.decoding_cipher_rsa is None:
                        self.decoding_rsa_key, self.decoding_cipher_rsa = encrypter.get_decrypt_decoding(tenant_id)

                    for variable in provider_credential_secret_variables:
                        if variable in provider_credentials:
                            try:
                                provider_credentials[variable] = encrypter.decrypt_token_with_decoding(
                                    provider_credentials.get(variable),
                                    self.decoding_rsa_key,
                                    self.decoding_cipher_rsa
                                )
                            except ValueError:
                                pass

                    current_using_credentials = provider_credentials

                    # cache provider credentials
                    provider_credentials_cache.set(
                        credentials=current_using_credentials
                    )
                else:
                    current_using_credentials = cached_provider_credentials
            else:
                current_using_credentials = {}
                quota_configurations = []

        return SystemConfiguration(
            enabled=True,
            current_quota_type=current_quota_type,
            quota_configurations=quota_configurations,
            credentials=current_using_credentials
        )

    def _choice_current_using_quota_type(self, quota_configurations: list[QuotaConfiguration]) -> ProviderQuotaType:
        """
        Choice current using quota type.
        paid quotas > provider free quotas > hosting trial quotas
        If there is still quota for the corresponding quota type according to the sorting,

        :param quota_configurations:
        :return:
        """
        # convert to dict
        quota_type_to_quota_configuration_dict = {
            quota_configuration.quota_type: quota_configuration
            for quota_configuration in quota_configurations
        }

        last_quota_configuration = None
        for quota_type in [ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL]:
            if quota_type in quota_type_to_quota_configuration_dict:
                last_quota_configuration = quota_type_to_quota_configuration_dict[quota_type]
                if last_quota_configuration.is_valid:
                    return quota_type

        if last_quota_configuration:
            return last_quota_configuration.quota_type

        raise ValueError('No quota type available')

    def _extract_secret_variables(self, credential_form_schemas: list[CredentialFormSchema]) -> list[str]:
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

    def _to_model_settings(self, provider_entity: ProviderEntity,
                           provider_model_settings: Optional[list[ProviderModelSetting]] = None,
                           load_balancing_model_configs: Optional[list[LoadBalancingModelConfig]] = None) \
            -> list[ModelSettings]:
        """
        Convert to model settings.

        :param provider_model_settings: provider model settings include enabled, load balancing enabled
        :param load_balancing_model_configs: load balancing model configs
        :return:
        """
        # Get provider model credential secret variables
        model_credential_secret_variables = self._extract_secret_variables(
            provider_entity.model_credential_schema.credential_form_schemas
            if provider_entity.model_credential_schema else []
        )

        model_settings = []
        if not provider_model_settings:
            return model_settings

        for provider_model_setting in provider_model_settings:
            load_balancing_configs = []
            if provider_model_setting.load_balancing_enabled and load_balancing_model_configs:
                for load_balancing_model_config in load_balancing_model_configs:
                    if (load_balancing_model_config.model_name == provider_model_setting.model_name
                            and load_balancing_model_config.model_type == provider_model_setting.model_type):
                        if not load_balancing_model_config.enabled:
                            continue

                        if not load_balancing_model_config.encrypted_config:
                            if load_balancing_model_config.name == "__inherit__":
                                load_balancing_configs.append(ModelLoadBalancingConfiguration(
                                    id=load_balancing_model_config.id,
                                    name=load_balancing_model_config.name,
                                    credentials={}
                                ))
                            continue

                        provider_model_credentials_cache = ProviderCredentialsCache(
                            tenant_id=load_balancing_model_config.tenant_id,
                            identity_id=load_balancing_model_config.id,
                            cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL
                        )

                        # Get cached provider model credentials
                        cached_provider_model_credentials = provider_model_credentials_cache.get()

                        if not cached_provider_model_credentials:
                            try:
                                provider_model_credentials = json.loads(load_balancing_model_config.encrypted_config)
                            except JSONDecodeError:
                                continue

                            # Get decoding rsa key and cipher for decrypting credentials
                            if self.decoding_rsa_key is None or self.decoding_cipher_rsa is None:
                                self.decoding_rsa_key, self.decoding_cipher_rsa = encrypter.get_decrypt_decoding(
                                    load_balancing_model_config.tenant_id)

                            for variable in model_credential_secret_variables:
                                if variable in provider_model_credentials:
                                    try:
                                        provider_model_credentials[variable] = encrypter.decrypt_token_with_decoding(
                                            provider_model_credentials.get(variable),
                                            self.decoding_rsa_key,
                                            self.decoding_cipher_rsa
                                        )
                                    except ValueError:
                                        pass

                            # cache provider model credentials
                            provider_model_credentials_cache.set(
                                credentials=provider_model_credentials
                            )
                        else:
                            provider_model_credentials = cached_provider_model_credentials

                        load_balancing_configs.append(ModelLoadBalancingConfiguration(
                            id=load_balancing_model_config.id,
                            name=load_balancing_model_config.name,
                            credentials=provider_model_credentials
                        ))

            model_settings.append(
                ModelSettings(
                    model=provider_model_setting.model_name,
                    model_type=ModelType.value_of(provider_model_setting.model_type),
                    enabled=provider_model_setting.enabled,
                    load_balancing_configs=load_balancing_configs if len(load_balancing_configs) > 1 else []
                )
            )

        return model_settings
