import contextlib
import json
from collections import defaultdict
from collections.abc import Sequence
from json import JSONDecodeError
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from configs import dify_config
from core.entities.model_entities import DefaultModelEntity, DefaultModelProviderEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations, ProviderModelBundle
from core.entities.provider_entities import (
    CredentialConfiguration,
    CustomConfiguration,
    CustomModelConfiguration,
    CustomProviderConfiguration,
    ModelLoadBalancingConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    SystemConfiguration,
    UnaddedModelConfiguration,
)
from core.helper import encrypter
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.helper.position_helper import is_filtered
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FormType,
    ProviderEntity,
)
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from extensions import ext_hosting_provider
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderType,
    TenantDefaultModel,
    TenantPreferredModelProvider,
)
from models.provider_ids import ModelProviderID
from services.feature_service import FeatureService


class ProviderManager:
    """
    ProviderManager is a class that manages the model providers includes Hosting and Customize Model Providers.
    """

    def __init__(self):
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
            tenant_id, provider_name_to_provider_records_dict
        )

        # append providers with langgenius/openai/openai
        provider_name_list = list(provider_name_to_provider_records_dict.keys())
        for provider_name in provider_name_list:
            provider_id = ModelProviderID(provider_name)
            if str(provider_id) not in provider_name_list:
                provider_name_to_provider_records_dict[str(provider_id)] = provider_name_to_provider_records_dict[
                    provider_name
                ]

        # Get all provider model records of the workspace
        provider_name_to_provider_model_records_dict = self._get_all_provider_models(tenant_id)
        for provider_name in list(provider_name_to_provider_model_records_dict.keys()):
            provider_id = ModelProviderID(provider_name)
            if str(provider_id) not in provider_name_to_provider_model_records_dict:
                provider_name_to_provider_model_records_dict[str(provider_id)] = (
                    provider_name_to_provider_model_records_dict[provider_name]
                )

        # Get all provider entities
        model_provider_factory = ModelProviderFactory(tenant_id)
        provider_entities = model_provider_factory.get_providers()

        # Get All preferred provider types of the workspace
        provider_name_to_preferred_model_provider_records_dict = self._get_all_preferred_model_providers(tenant_id)
        # Ensure that both the original provider name and its ModelProviderID string representation
        # are present in the dictionary to handle cases where either form might be used
        for provider_name in list(provider_name_to_preferred_model_provider_records_dict.keys()):
            provider_id = ModelProviderID(provider_name)
            if str(provider_id) not in provider_name_to_preferred_model_provider_records_dict:
                # Add the ModelProviderID string representation if it's not already present
                provider_name_to_preferred_model_provider_records_dict[str(provider_id)] = (
                    provider_name_to_preferred_model_provider_records_dict[provider_name]
                )

        # Get All provider model settings
        provider_name_to_provider_model_settings_dict = self._get_all_provider_model_settings(tenant_id)

        # Get All load balancing configs
        provider_name_to_provider_load_balancing_model_configs_dict = self._get_all_provider_load_balancing_configs(
            tenant_id
        )

        # Get All provider model credentials
        provider_name_to_provider_model_credentials_dict = self._get_all_provider_model_credentials(tenant_id)

        provider_configurations = ProviderConfigurations(tenant_id=tenant_id)

        # Construct ProviderConfiguration objects for each provider
        for provider_entity in provider_entities:
            # handle include, exclude
            if is_filtered(
                include_set=dify_config.POSITION_PROVIDER_INCLUDES_SET,
                exclude_set=dify_config.POSITION_PROVIDER_EXCLUDES_SET,
                data=provider_entity,
                name_func=lambda x: x.provider,
            ):
                continue

            provider_name = provider_entity.provider
            provider_records = provider_name_to_provider_records_dict.get(provider_entity.provider, [])
            provider_model_records = provider_name_to_provider_model_records_dict.get(provider_entity.provider, [])
            provider_id_entity = ModelProviderID(provider_name)
            if provider_id_entity.is_langgenius():
                provider_model_records.extend(
                    provider_name_to_provider_model_records_dict.get(provider_id_entity.provider_name, [])
                )
            provider_model_credentials = provider_name_to_provider_model_credentials_dict.get(
                provider_entity.provider, []
            )
            provider_id_entity = ModelProviderID(provider_name)
            if provider_id_entity.is_langgenius():
                provider_model_credentials.extend(
                    provider_name_to_provider_model_credentials_dict.get(provider_id_entity.provider_name, [])
                )

            # Convert to custom configuration
            custom_configuration = self._to_custom_configuration(
                tenant_id, provider_entity, provider_records, provider_model_records, provider_model_credentials
            )

            # Convert to system configuration
            system_configuration = self._to_system_configuration(tenant_id, provider_entity, provider_records)

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
            provider_load_balancing_configs = provider_name_to_provider_load_balancing_model_configs_dict.get(
                provider_name
            )

            provider_id_entity = ModelProviderID(provider_name)

            if provider_id_entity.is_langgenius():
                if provider_model_settings is not None:
                    provider_model_settings.extend(
                        provider_name_to_provider_model_settings_dict.get(provider_id_entity.provider_name, [])
                    )
                if provider_load_balancing_configs is not None:
                    provider_load_balancing_configs.extend(
                        provider_name_to_provider_load_balancing_model_configs_dict.get(
                            provider_id_entity.provider_name, []
                        )
                    )

            # Convert to model settings
            model_settings = self._to_model_settings(
                provider_entity=provider_entity,
                provider_model_settings=provider_model_settings,
                load_balancing_model_configs=provider_load_balancing_configs,
            )

            provider_configuration = ProviderConfiguration(
                tenant_id=tenant_id,
                provider=provider_entity,
                preferred_provider_type=preferred_provider_type,
                using_provider_type=using_provider_type,
                system_configuration=system_configuration,
                custom_configuration=custom_configuration,
                model_settings=model_settings,
            )

            provider_configurations[str(provider_id_entity)] = provider_configuration

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

        model_type_instance = provider_configuration.get_model_type_instance(model_type)

        return ProviderModelBundle(
            configuration=provider_configuration,
            model_type_instance=model_type_instance,
        )

    def get_default_model(self, tenant_id: str, model_type: ModelType) -> DefaultModelEntity | None:
        """
        Get default model.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        stmt = select(TenantDefaultModel).where(
            TenantDefaultModel.tenant_id == tenant_id,
            TenantDefaultModel.model_type == model_type.to_origin_model_type(),
        )
        default_model = db.session.scalar(stmt)

        # If it does not exist, get the first available provider model from get_configurations
        # and update the TenantDefaultModel record
        if not default_model:
            # Get provider configurations
            provider_configurations = self.get_configurations(tenant_id)

            # get available models from provider_configurations
            available_models = provider_configurations.get_models(model_type=model_type, only_active=True)

            if available_models:
                available_model = next(
                    (model for model in available_models if model.model == "gpt-4"), available_models[0]
                )

                default_model = TenantDefaultModel()
                default_model.tenant_id = tenant_id
                default_model.model_type = model_type.to_origin_model_type()
                default_model.provider_name = available_model.provider.provider
                default_model.model_name = available_model.model
                db.session.add(default_model)
                db.session.commit()

        if not default_model:
            return None

        model_provider_factory = ModelProviderFactory(tenant_id)
        provider_schema = model_provider_factory.get_provider_schema(provider=default_model.provider_name)

        return DefaultModelEntity(
            model=default_model.model_name,
            model_type=model_type,
            provider=DefaultModelProviderEntity(
                provider=provider_schema.provider,
                label=provider_schema.label,
                icon_small=provider_schema.icon_small,
                icon_large=provider_schema.icon_large,
                supported_model_types=provider_schema.supported_model_types,
            ),
        )

    def get_first_provider_first_model(self, tenant_id: str, model_type: ModelType) -> tuple[str | None, str | None]:
        """
        Get names of first model and its provider

        :param tenant_id: workspace id
        :param model_type: model type
        :return: provider name, model name
        """
        provider_configurations = self.get_configurations(tenant_id)

        # get available models from provider_configurations
        all_models = provider_configurations.get_models(model_type=model_type, only_active=False)

        if not all_models:
            return None, None

        return all_models[0].provider.provider, all_models[0].model

    def update_default_model_record(
        self, tenant_id: str, model_type: ModelType, provider: str, model: str
    ) -> TenantDefaultModel:
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
        available_models = provider_configurations.get_models(model_type=model_type, only_active=True)

        # check if the model is exist in available models
        model_names = [model.model for model in available_models]
        if model not in model_names:
            raise ValueError(f"Model {model} does not exist.")
        stmt = select(TenantDefaultModel).where(
            TenantDefaultModel.tenant_id == tenant_id,
            TenantDefaultModel.model_type == model_type.to_origin_model_type(),
        )
        default_model = db.session.scalar(stmt)

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

    @staticmethod
    def _get_all_providers(tenant_id: str) -> dict[str, list[Provider]]:
        provider_name_to_provider_records_dict = defaultdict(list)
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(Provider).where(Provider.tenant_id == tenant_id, Provider.is_valid == True)
            providers = session.scalars(stmt)
            for provider in providers:
                # Use provider name with prefix after the data migration
                provider_name_to_provider_records_dict[str(ModelProviderID(provider.provider_name))].append(provider)
        return provider_name_to_provider_records_dict

    @staticmethod
    def _get_all_provider_models(tenant_id: str) -> dict[str, list[ProviderModel]]:
        """
        Get all provider model records of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        provider_name_to_provider_model_records_dict = defaultdict(list)
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(ProviderModel).where(ProviderModel.tenant_id == tenant_id, ProviderModel.is_valid == True)
            provider_models = session.scalars(stmt)
            for provider_model in provider_models:
                provider_name_to_provider_model_records_dict[provider_model.provider_name].append(provider_model)
        return provider_name_to_provider_model_records_dict

    @staticmethod
    def _get_all_preferred_model_providers(tenant_id: str) -> dict[str, TenantPreferredModelProvider]:
        """
        Get All preferred provider types of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        provider_name_to_preferred_provider_type_records_dict = {}
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(TenantPreferredModelProvider).where(TenantPreferredModelProvider.tenant_id == tenant_id)
            preferred_provider_types = session.scalars(stmt)
            provider_name_to_preferred_provider_type_records_dict = {
                preferred_provider_type.provider_name: preferred_provider_type
                for preferred_provider_type in preferred_provider_types
            }
        return provider_name_to_preferred_provider_type_records_dict

    @staticmethod
    def _get_all_provider_model_settings(tenant_id: str) -> dict[str, list[ProviderModelSetting]]:
        """
        Get All provider model settings of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        provider_name_to_provider_model_settings_dict = defaultdict(list)
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(ProviderModelSetting).where(ProviderModelSetting.tenant_id == tenant_id)
            provider_model_settings = session.scalars(stmt)
            for provider_model_setting in provider_model_settings:
                provider_name_to_provider_model_settings_dict[provider_model_setting.provider_name].append(
                    provider_model_setting
                )
        return provider_name_to_provider_model_settings_dict

    @staticmethod
    def _get_all_provider_model_credentials(tenant_id: str) -> dict[str, list[ProviderModelCredential]]:
        """
        Get All provider model credentials of the workspace.

        :param tenant_id: workspace id
        :return:
        """
        provider_name_to_provider_model_credentials_dict = defaultdict(list)
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(ProviderModelCredential).where(ProviderModelCredential.tenant_id == tenant_id)
            provider_model_credentials = session.scalars(stmt)
            for provider_model_credential in provider_model_credentials:
                provider_name_to_provider_model_credentials_dict[provider_model_credential.provider_name].append(
                    provider_model_credential
                )
        return provider_name_to_provider_model_credentials_dict

    @staticmethod
    def _get_all_provider_load_balancing_configs(tenant_id: str) -> dict[str, list[LoadBalancingModelConfig]]:
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
            cache_result = cache_result.decode("utf-8")
            model_load_balancing_enabled = cache_result == "True"

        if not model_load_balancing_enabled:
            return {}

        provider_name_to_provider_load_balancing_model_configs_dict = defaultdict(list)
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.tenant_id == tenant_id)
            provider_load_balancing_configs = session.scalars(stmt)
            for provider_load_balancing_config in provider_load_balancing_configs:
                provider_name_to_provider_load_balancing_model_configs_dict[
                    provider_load_balancing_config.provider_name
                ].append(provider_load_balancing_config)

        return provider_name_to_provider_load_balancing_model_configs_dict

    @staticmethod
    def _get_provider_names(provider_name: str) -> list[str]:
        """
        provider_name: `openai` or `langgenius/openai/openai`
        return: [`openai`, `langgenius/openai/openai`]
        """
        provider_names = [provider_name]
        model_provider_id = ModelProviderID(provider_name)
        if model_provider_id.is_langgenius():
            if "/" in provider_name:
                provider_names.append(model_provider_id.provider_name)
            else:
                provider_names.append(str(model_provider_id))
        return provider_names

    @staticmethod
    def get_provider_available_credentials(tenant_id: str, provider_name: str) -> list[CredentialConfiguration]:
        """
        Get provider all credentials.

        :param tenant_id: workspace id
        :param provider_name: provider name
        :return:
        """
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(ProviderCredential)
                .where(
                    ProviderCredential.tenant_id == tenant_id,
                    ProviderCredential.provider_name.in_(ProviderManager._get_provider_names(provider_name)),
                )
                .order_by(ProviderCredential.created_at.desc())
            )

            available_credentials = session.scalars(stmt).all()

        return [
            CredentialConfiguration(credential_id=credential.id, credential_name=credential.credential_name)
            for credential in available_credentials
        ]

    @staticmethod
    def get_provider_model_available_credentials(
        tenant_id: str, provider_name: str, model_name: str, model_type: str
    ) -> list[CredentialConfiguration]:
        """
        Get provider custom model all credentials.

        :param tenant_id: workspace id
        :param provider_name: provider name
        :param model_name: model name
        :param model_type: model type
        :return:
        """
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(ProviderModelCredential)
                .where(
                    ProviderModelCredential.tenant_id == tenant_id,
                    ProviderModelCredential.provider_name.in_(ProviderManager._get_provider_names(provider_name)),
                    ProviderModelCredential.model_name == model_name,
                    ProviderModelCredential.model_type == model_type,
                )
                .order_by(ProviderModelCredential.created_at.desc())
            )

            available_credentials = session.scalars(stmt).all()

        return [
            CredentialConfiguration(credential_id=credential.id, credential_name=credential.credential_name)
            for credential in available_credentials
        ]

    @staticmethod
    def _init_trial_provider_records(
        tenant_id: str, provider_name_to_provider_records_dict: dict[str, list[Provider]]
    ) -> dict[str, list[Provider]]:
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

            provider_quota_to_provider_record_dict = {}
            for provider_record in provider_records:
                if provider_record.provider_type != ProviderType.SYSTEM:
                    continue

                provider_quota_to_provider_record_dict[ProviderQuotaType.value_of(provider_record.quota_type)] = (
                    provider_record
                )

            for quota in configuration.quotas:
                if quota.quota_type == ProviderQuotaType.TRIAL:
                    # Init trial provider records if not exists
                    if ProviderQuotaType.TRIAL not in provider_quota_to_provider_record_dict:
                        try:
                            # FIXME ignore the type error, only TrialHostingQuota has limit need to change the logic
                            new_provider_record = Provider(
                                tenant_id=tenant_id,
                                # TODO: Use provider name with prefix after the data migration.
                                provider_name=ModelProviderID(provider_name).provider_name,
                                provider_type=ProviderType.SYSTEM,
                                quota_type=ProviderQuotaType.TRIAL,
                                quota_limit=quota.quota_limit,  # type: ignore
                                quota_used=0,
                                is_valid=True,
                            )
                            db.session.add(new_provider_record)
                            db.session.commit()
                            provider_name_to_provider_records_dict[provider_name].append(new_provider_record)
                        except IntegrityError:
                            db.session.rollback()
                            stmt = select(Provider).where(
                                Provider.tenant_id == tenant_id,
                                Provider.provider_name == ModelProviderID(provider_name).provider_name,
                                Provider.provider_type == ProviderType.SYSTEM,
                                Provider.quota_type == ProviderQuotaType.TRIAL,
                            )
                            existed_provider_record = db.session.scalar(stmt)
                            if not existed_provider_record:
                                continue

                            if not existed_provider_record.is_valid:
                                existed_provider_record.is_valid = True
                                db.session.commit()

                            provider_name_to_provider_records_dict[provider_name].append(existed_provider_record)

        return provider_name_to_provider_records_dict

    def _to_custom_configuration(
        self,
        tenant_id: str,
        provider_entity: ProviderEntity,
        provider_records: list[Provider],
        provider_model_records: list[ProviderModel],
        provider_model_credentials: list[ProviderModelCredential],
    ) -> CustomConfiguration:
        """
        Convert to custom configuration.

        :param tenant_id: workspace id
        :param provider_entity: provider entity
        :param provider_records: provider records
        :param provider_model_records: provider model records
        :return:
        """
        # Get custom provider configuration
        custom_provider_configuration = self._get_custom_provider_configuration(
            tenant_id, provider_entity, provider_records
        )

        # Get custom models which have not been added to the model list yet
        unadded_models = self._get_can_added_models(provider_model_records, provider_model_credentials)

        # Get custom model configurations
        custom_model_configurations = self._get_custom_model_configurations(
            tenant_id, provider_entity, provider_model_records, unadded_models, provider_model_credentials
        )

        can_added_models = [
            UnaddedModelConfiguration(model=model["model"], model_type=model["model_type"]) for model in unadded_models
        ]

        return CustomConfiguration(
            provider=custom_provider_configuration,
            models=custom_model_configurations,
            can_added_models=can_added_models,
        )

    def _get_custom_provider_configuration(
        self, tenant_id: str, provider_entity: ProviderEntity, provider_records: list[Provider]
    ) -> CustomProviderConfiguration | None:
        """Get custom provider configuration."""
        # Find custom provider record (non-system)
        custom_provider_record = next(
            (record for record in provider_records if record.provider_type != ProviderType.SYSTEM), None
        )

        if not custom_provider_record:
            return None

        # Get provider credential secret variables
        provider_credential_secret_variables = self._extract_secret_variables(
            provider_entity.provider_credential_schema.credential_form_schemas
            if provider_entity.provider_credential_schema
            else []
        )

        # Get and decrypt provider credentials
        provider_credentials = self._get_and_decrypt_credentials(
            tenant_id=tenant_id,
            record_id=custom_provider_record.id,
            encrypted_config=custom_provider_record.encrypted_config,
            secret_variables=provider_credential_secret_variables,
            cache_type=ProviderCredentialsCacheType.PROVIDER,
            is_provider=True,
        )

        return CustomProviderConfiguration(
            credentials=provider_credentials,
            current_credential_name=custom_provider_record.credential_name,
            current_credential_id=custom_provider_record.credential_id,
            available_credentials=self.get_provider_available_credentials(
                tenant_id, custom_provider_record.provider_name
            ),
        )

    def _get_can_added_models(
        self, provider_model_records: list[ProviderModel], all_model_credentials: Sequence[ProviderModelCredential]
    ) -> list[dict]:
        """Get the custom models and credentials from enterprise version which haven't add to the model list"""
        existing_model_set = {(record.model_name, record.model_type) for record in provider_model_records}

        # Get not added custom models credentials
        not_added_custom_models_credentials = [
            credential
            for credential in all_model_credentials
            if (credential.model_name, credential.model_type) not in existing_model_set
        ]

        # Group credentials by model
        model_to_credentials = defaultdict(list)
        for credential in not_added_custom_models_credentials:
            model_to_credentials[(credential.model_name, credential.model_type)].append(credential)

        return [
            {
                "model": model_key[0],
                "model_type": ModelType.value_of(model_key[1]),
                "available_model_credentials": [
                    CredentialConfiguration(credential_id=cred.id, credential_name=cred.credential_name)
                    for cred in creds
                ],
            }
            for model_key, creds in model_to_credentials.items()
        ]

    def _get_custom_model_configurations(
        self,
        tenant_id: str,
        provider_entity: ProviderEntity,
        provider_model_records: list[ProviderModel],
        can_added_models: list[dict],
        all_model_credentials: Sequence[ProviderModelCredential],
    ) -> list[CustomModelConfiguration]:
        """Get custom model configurations."""
        # Get model credential secret variables
        model_credential_secret_variables = self._extract_secret_variables(
            provider_entity.model_credential_schema.credential_form_schemas
            if provider_entity.model_credential_schema
            else []
        )

        # Create credentials lookup for efficient access
        credentials_map = defaultdict(list)
        for credential in all_model_credentials:
            credentials_map[(credential.model_name, credential.model_type)].append(credential)

        custom_model_configurations = []

        # Process existing model records
        for provider_model_record in provider_model_records:
            # Use pre-fetched credentials instead of individual database calls
            available_model_credentials = [
                CredentialConfiguration(credential_id=cred.id, credential_name=cred.credential_name)
                for cred in credentials_map.get(
                    (provider_model_record.model_name, provider_model_record.model_type), []
                )
            ]

            # Get and decrypt model credentials
            provider_model_credentials = self._get_and_decrypt_credentials(
                tenant_id=tenant_id,
                record_id=provider_model_record.id,
                encrypted_config=provider_model_record.encrypted_config,
                secret_variables=model_credential_secret_variables,
                cache_type=ProviderCredentialsCacheType.MODEL,
                is_provider=False,
            )

            custom_model_configurations.append(
                CustomModelConfiguration(
                    model=provider_model_record.model_name,
                    model_type=ModelType.value_of(provider_model_record.model_type),
                    credentials=provider_model_credentials,
                    current_credential_id=provider_model_record.credential_id,
                    current_credential_name=provider_model_record.credential_name,
                    available_model_credentials=available_model_credentials,
                )
            )

        # Add models that can be added
        for model in can_added_models:
            custom_model_configurations.append(
                CustomModelConfiguration(
                    model=model["model"],
                    model_type=model["model_type"],
                    credentials=None,
                    current_credential_id=None,
                    current_credential_name=None,
                    available_model_credentials=model["available_model_credentials"],
                    unadded_to_model_list=True,
                )
            )

        return custom_model_configurations

    def _get_and_decrypt_credentials(
        self,
        tenant_id: str,
        record_id: str,
        encrypted_config: str | None,
        secret_variables: list[str],
        cache_type: ProviderCredentialsCacheType,
        is_provider: bool = False,
    ) -> dict:
        """Get and decrypt credentials with caching."""
        credentials_cache = ProviderCredentialsCache(
            tenant_id=tenant_id,
            identity_id=record_id,
            cache_type=cache_type,
        )

        # Try to get from cache first
        cached_credentials = credentials_cache.get()
        if cached_credentials:
            return cached_credentials

        # Parse encrypted config
        if not encrypted_config:
            return {}

        if is_provider and not encrypted_config.startswith("{"):
            return {"openai_api_key": encrypted_config}

        try:
            credentials = cast(dict, json.loads(encrypted_config))
        except JSONDecodeError:
            return {}

        # Decrypt secret variables
        if self.decoding_rsa_key is None or self.decoding_cipher_rsa is None:
            self.decoding_rsa_key, self.decoding_cipher_rsa = encrypter.get_decrypt_decoding(tenant_id)

        for variable in secret_variables:
            if variable in credentials:
                with contextlib.suppress(ValueError):
                    credentials[variable] = encrypter.decrypt_token_with_decoding(
                        credentials.get(variable) or "",
                        self.decoding_rsa_key,
                        self.decoding_cipher_rsa,
                    )

        # Cache the decrypted credentials
        credentials_cache.set(credentials=credentials)
        return credentials

    def _to_system_configuration(
        self, tenant_id: str, provider_entity: ProviderEntity, provider_records: list[Provider]
    ) -> SystemConfiguration:
        """
        Convert to system configuration.

        :param tenant_id: workspace id
        :param provider_entity: provider entity
        :param provider_records: provider records
        :return:
        """
        # Get hosting configuration
        hosting_configuration = ext_hosting_provider.hosting_configuration

        provider_hosting_configuration = hosting_configuration.provider_map.get(provider_entity.provider)
        if provider_hosting_configuration is None or not provider_hosting_configuration.enabled:
            return SystemConfiguration(enabled=False)

        # Convert provider_records to dict
        quota_type_to_provider_records_dict: dict[ProviderQuotaType, Provider] = {}
        for provider_record in provider_records:
            if provider_record.provider_type != ProviderType.SYSTEM:
                continue

            quota_type_to_provider_records_dict[ProviderQuotaType.value_of(provider_record.quota_type)] = (
                provider_record
            )
        quota_configurations = []
        for provider_quota in provider_hosting_configuration.quotas:
            if provider_quota.quota_type not in quota_type_to_provider_records_dict:
                if provider_quota.quota_type == ProviderQuotaType.FREE:
                    quota_configuration = QuotaConfiguration(
                        quota_type=provider_quota.quota_type,
                        quota_unit=provider_hosting_configuration.quota_unit or QuotaUnit.TOKENS,
                        quota_used=0,
                        quota_limit=0,
                        is_valid=False,
                        restrict_models=provider_quota.restrict_models,
                    )
                else:
                    continue
            else:
                provider_record = quota_type_to_provider_records_dict[provider_quota.quota_type]

                if provider_record.quota_used is None:
                    raise ValueError("quota_used is None")
                if provider_record.quota_limit is None:
                    raise ValueError("quota_limit is None")

                quota_configuration = QuotaConfiguration(
                    quota_type=provider_quota.quota_type,
                    quota_unit=provider_hosting_configuration.quota_unit or QuotaUnit.TOKENS,
                    quota_used=provider_record.quota_used,
                    quota_limit=provider_record.quota_limit,
                    is_valid=provider_record.quota_limit > provider_record.quota_used
                    or provider_record.quota_limit == -1,
                    restrict_models=provider_quota.restrict_models,
                )

            quota_configurations.append(quota_configuration)

        if len(quota_configurations) == 0:
            return SystemConfiguration(enabled=False)

        current_quota_type = self._choice_current_using_quota_type(quota_configurations)

        current_using_credentials = provider_hosting_configuration.credentials
        if current_quota_type == ProviderQuotaType.FREE:
            provider_record_quota_free = quota_type_to_provider_records_dict.get(current_quota_type)

            if provider_record_quota_free:
                provider_credentials_cache = ProviderCredentialsCache(
                    tenant_id=tenant_id,
                    identity_id=provider_record_quota_free.id,
                    cache_type=ProviderCredentialsCacheType.PROVIDER,
                )

                # Get cached provider credentials
                # error occurs
                cached_provider_credentials = provider_credentials_cache.get()

                if not cached_provider_credentials:
                    provider_credentials: dict[str, Any] = {}
                    if provider_records and provider_records[0].encrypted_config:
                        provider_credentials = json.loads(provider_records[0].encrypted_config)

                    # Get provider credential secret variables
                    provider_credential_secret_variables = self._extract_secret_variables(
                        provider_entity.provider_credential_schema.credential_form_schemas
                        if provider_entity.provider_credential_schema
                        else []
                    )

                    # Get decoding rsa key and cipher for decrypting credentials
                    if self.decoding_rsa_key is None or self.decoding_cipher_rsa is None:
                        self.decoding_rsa_key, self.decoding_cipher_rsa = encrypter.get_decrypt_decoding(tenant_id)

                    for variable in provider_credential_secret_variables:
                        if variable in provider_credentials:
                            try:
                                provider_credentials[variable] = encrypter.decrypt_token_with_decoding(
                                    provider_credentials.get(variable, ""),
                                    self.decoding_rsa_key,
                                    self.decoding_cipher_rsa,
                                )
                            except ValueError:
                                pass

                    current_using_credentials = provider_credentials or {}

                    # cache provider credentials
                    provider_credentials_cache.set(credentials=current_using_credentials)
                else:
                    current_using_credentials = cached_provider_credentials
            else:
                current_using_credentials = {}
                quota_configurations = []

        return SystemConfiguration(
            enabled=True,
            current_quota_type=current_quota_type,
            quota_configurations=quota_configurations,
            credentials=current_using_credentials,
        )

    @staticmethod
    def _choice_current_using_quota_type(quota_configurations: list[QuotaConfiguration]) -> ProviderQuotaType:
        """
        Choice current using quota type.
        paid quotas > provider free quotas > hosting trial quotas
        If there is still quota for the corresponding quota type according to the sorting,

        :param quota_configurations:
        :return:
        """
        # convert to dict
        quota_type_to_quota_configuration_dict = {
            quota_configuration.quota_type: quota_configuration for quota_configuration in quota_configurations
        }

        last_quota_configuration = None
        for quota_type in [ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL]:
            if quota_type in quota_type_to_quota_configuration_dict:
                last_quota_configuration = quota_type_to_quota_configuration_dict[quota_type]
                if last_quota_configuration.is_valid:
                    return quota_type

        if last_quota_configuration:
            return last_quota_configuration.quota_type

        raise ValueError("No quota type available")

    @staticmethod
    def _extract_secret_variables(credential_form_schemas: list[CredentialFormSchema]) -> list[str]:
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

    def _to_model_settings(
        self,
        provider_entity: ProviderEntity,
        provider_model_settings: list[ProviderModelSetting] | None = None,
        load_balancing_model_configs: list[LoadBalancingModelConfig] | None = None,
    ) -> list[ModelSettings]:
        """
        Convert to model settings.
        :param provider_entity: provider entity
        :param provider_model_settings: provider model settings include enabled, load balancing enabled
        :param load_balancing_model_configs: load balancing model configs
        :return:
        """
        # Get provider model credential secret variables
        if ConfigurateMethod.PREDEFINED_MODEL in provider_entity.configurate_methods:
            model_credential_secret_variables = self._extract_secret_variables(
                provider_entity.provider_credential_schema.credential_form_schemas
                if provider_entity.provider_credential_schema
                else []
            )
        else:
            model_credential_secret_variables = self._extract_secret_variables(
                provider_entity.model_credential_schema.credential_form_schemas
                if provider_entity.model_credential_schema
                else []
            )

        model_settings: list[ModelSettings] = []
        if not provider_model_settings:
            return model_settings

        for provider_model_setting in provider_model_settings:
            load_balancing_configs = []
            if provider_model_setting.load_balancing_enabled and load_balancing_model_configs:
                for load_balancing_model_config in load_balancing_model_configs:
                    if (
                        load_balancing_model_config.model_name == provider_model_setting.model_name
                        and load_balancing_model_config.model_type == provider_model_setting.model_type
                    ):
                        if not load_balancing_model_config.enabled:
                            continue

                        if not load_balancing_model_config.encrypted_config:
                            if load_balancing_model_config.name == "__inherit__":
                                load_balancing_configs.append(
                                    ModelLoadBalancingConfiguration(
                                        id=load_balancing_model_config.id,
                                        name=load_balancing_model_config.name,
                                        credentials={},
                                    )
                                )
                            continue

                        provider_model_credentials_cache = ProviderCredentialsCache(
                            tenant_id=load_balancing_model_config.tenant_id,
                            identity_id=load_balancing_model_config.id,
                            cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
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
                                    load_balancing_model_config.tenant_id
                                )

                            for variable in model_credential_secret_variables:
                                if variable in provider_model_credentials:
                                    try:
                                        provider_model_credentials[variable] = encrypter.decrypt_token_with_decoding(
                                            provider_model_credentials.get(variable),
                                            self.decoding_rsa_key,
                                            self.decoding_cipher_rsa,
                                        )
                                    except ValueError:
                                        pass

                            # cache provider model credentials
                            provider_model_credentials_cache.set(credentials=provider_model_credentials)
                        else:
                            provider_model_credentials = cached_provider_model_credentials

                        load_balancing_configs.append(
                            ModelLoadBalancingConfiguration(
                                id=load_balancing_model_config.id,
                                name=load_balancing_model_config.name,
                                credentials=provider_model_credentials,
                                credential_source_type=load_balancing_model_config.credential_source_type,
                                credential_id=load_balancing_model_config.credential_id,
                            )
                        )

            model_settings.append(
                ModelSettings(
                    model=provider_model_setting.model_name,
                    model_type=ModelType.value_of(provider_model_setting.model_type),
                    enabled=provider_model_setting.enabled,
                    load_balancing_enabled=provider_model_setting.load_balancing_enabled,
                    load_balancing_configs=load_balancing_configs if len(load_balancing_configs) > 1 else [],
                )
            )

        return model_settings
