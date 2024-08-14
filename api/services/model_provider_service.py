import logging
import mimetypes
import os
from typing import Optional, cast

import requests
from flask import current_app

from core.entities.model_entities import ModelStatus, ProviderModelWithStatusEntity
from core.model_runtime.entities.model_entities import ModelType, ParameterRule
from core.model_runtime.model_providers import model_provider_factory
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.provider_manager import ProviderManager
from models.provider import ProviderType
from services.entities.model_provider_entities import (
    CustomConfigurationResponse,
    CustomConfigurationStatus,
    DefaultModelResponse,
    ModelWithProviderEntityResponse,
    ProviderResponse,
    ProviderWithModelsResponse,
    SimpleProviderEntityResponse,
    SystemConfigurationResponse,
)

logger = logging.getLogger(__name__)


class ModelProviderService:
    """
    Model Provider Service
    """
    def __init__(self) -> None:
        self.provider_manager = ProviderManager()

    def get_provider_list(self, tenant_id: str, model_type: Optional[str] = None) -> list[ProviderResponse]:
        """
        get provider list.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        provider_responses = []
        for provider_configuration in provider_configurations.values():
            if model_type:
                model_type_entity = ModelType.value_of(model_type)
                if model_type_entity not in provider_configuration.provider.supported_model_types:
                    continue

            provider_response = ProviderResponse(
                provider=provider_configuration.provider.provider,
                label=provider_configuration.provider.label,
                description=provider_configuration.provider.description,
                icon_small=provider_configuration.provider.icon_small,
                icon_large=provider_configuration.provider.icon_large,
                background=provider_configuration.provider.background,
                help=provider_configuration.provider.help,
                supported_model_types=provider_configuration.provider.supported_model_types,
                configurate_methods=provider_configuration.provider.configurate_methods,
                provider_credential_schema=provider_configuration.provider.provider_credential_schema,
                model_credential_schema=provider_configuration.provider.model_credential_schema,
                preferred_provider_type=provider_configuration.preferred_provider_type,
                custom_configuration=CustomConfigurationResponse(
                    status=CustomConfigurationStatus.ACTIVE
                    if provider_configuration.is_custom_configuration_available()
                    else CustomConfigurationStatus.NO_CONFIGURE
                ),
                system_configuration=SystemConfigurationResponse(
                    enabled=provider_configuration.system_configuration.enabled,
                    current_quota_type=provider_configuration.system_configuration.current_quota_type,
                    quota_configurations=provider_configuration.system_configuration.quota_configurations
                )
            )

            provider_responses.append(provider_response)

        return provider_responses

    def get_models_by_provider(self, tenant_id: str, provider: str) -> list[ModelWithProviderEntityResponse]:
        """
        get provider models.
        For the model provider page,
        only supports passing in a single provider to query the list of supported models.

        :param tenant_id:
        :param provider:
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider available models
        return [ModelWithProviderEntityResponse(model) for model in provider_configurations.get_models(
            provider=provider
        )]

    def get_provider_credentials(self, tenant_id: str, provider: str) -> dict:
        """
        get provider credentials.

        :param tenant_id:
        :param provider:
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Get provider custom credentials from workspace
        return provider_configuration.get_custom_credentials(obfuscated=True)

    def provider_credentials_validate(self, tenant_id: str, provider: str, credentials: dict) -> None:
        """
        validate provider credentials.

        :param tenant_id:
        :param provider:
        :param credentials:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        provider_configuration.custom_credentials_validate(credentials)

    def save_provider_credentials(self, tenant_id: str, provider: str, credentials: dict) -> None:
        """
        save custom provider config.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Add or update custom provider credentials.
        provider_configuration.add_or_update_custom_credentials(credentials)

    def remove_provider_credentials(self, tenant_id: str, provider: str) -> None:
        """
        remove custom provider config.

        :param tenant_id: workspace id
        :param provider: provider name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Remove custom provider credentials.
        provider_configuration.delete_custom_credentials()

    def get_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> dict:
        """
        get model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Get model custom credentials from ProviderModel if exists
        return provider_configuration.get_custom_model_credentials(
            model_type=ModelType.value_of(model_type),
            model=model,
            obfuscated=True
        )

    def model_credentials_validate(self, tenant_id: str, provider: str, model_type: str, model: str,
                                   credentials: dict) -> None:
        """
        validate model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Validate model credentials
        provider_configuration.custom_model_credentials_validate(
            model_type=ModelType.value_of(model_type),
            model=model,
            credentials=credentials
        )

    def save_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str,
                               credentials: dict) -> None:
        """
        save model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Add or update custom model credentials
        provider_configuration.add_or_update_custom_model_credentials(
            model_type=ModelType.value_of(model_type),
            model=model,
            credentials=credentials
        )

    def remove_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> None:
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Remove custom model credentials
        provider_configuration.delete_custom_model_credentials(
            model_type=ModelType.value_of(model_type),
            model=model
        )

    def get_models_by_model_type(self, tenant_id: str, model_type: str) -> list[ProviderWithModelsResponse]:
        """
        get models by model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider available models
        models = provider_configurations.get_models(
            model_type=ModelType.value_of(model_type)
        )

        # Group models by provider
        provider_models = {}
        for model in models:
            if model.provider.provider not in provider_models:
                provider_models[model.provider.provider] = []

            if model.deprecated:
                continue

            if model.status != ModelStatus.ACTIVE:
                continue

            provider_models[model.provider.provider].append(model)

        # convert to ProviderWithModelsResponse list
        providers_with_models: list[ProviderWithModelsResponse] = []
        for provider, models in provider_models.items():
            if not models:
                continue

            first_model = models[0]

            providers_with_models.append(
                ProviderWithModelsResponse(
                    provider=provider,
                    label=first_model.provider.label,
                    icon_small=first_model.provider.icon_small,
                    icon_large=first_model.provider.icon_large,
                    status=CustomConfigurationStatus.ACTIVE,
                    models=[ProviderModelWithStatusEntity(
                        model=model.model,
                        label=model.label,
                        model_type=model.model_type,
                        features=model.features,
                        fetch_from=model.fetch_from,
                        model_properties=model.model_properties,
                        status=model.status,
                        load_balancing_enabled=model.load_balancing_enabled
                    ) for model in models]
                )
            )

        return providers_with_models

    def get_model_parameter_rules(self, tenant_id: str, provider: str, model: str) -> list[ParameterRule]:
        """
        get model parameter rules.
        Only supports LLM.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Get model instance of LLM
        model_type_instance = provider_configuration.get_model_type_instance(ModelType.LLM)
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        # fetch credentials
        credentials = provider_configuration.get_current_credentials(
            model_type=ModelType.LLM,
            model=model
        )

        if not credentials:
            return []

        # Call get_parameter_rules method of model instance to get model parameter rules
        return model_type_instance.get_parameter_rules(
            model=model,
            credentials=credentials
        )

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> Optional[DefaultModelResponse]:
        """
        get default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        model_type_enum = ModelType.value_of(model_type)
        result = self.provider_manager.get_default_model(
            tenant_id=tenant_id,
            model_type=model_type_enum
        )

        return DefaultModelResponse(
            model=result.model,
            model_type=result.model_type,
            provider=SimpleProviderEntityResponse(
                provider=result.provider.provider,
                label=result.provider.label,
                icon_small=result.provider.icon_small,
                icon_large=result.provider.icon_large,
                supported_model_types=result.provider.supported_model_types
            )
        ) if result else None

    def update_default_model_of_model_type(self, tenant_id: str, model_type: str, provider: str, model: str) -> None:
        """
        update default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :param provider: provider name
        :param model: model name
        :return:
        """
        model_type_enum = ModelType.value_of(model_type)
        self.provider_manager.update_default_model_record(
            tenant_id=tenant_id,
            model_type=model_type_enum,
            provider=provider,
            model=model
        )

    def get_model_provider_icon(self, provider: str, icon_type: str, lang: str) -> tuple[Optional[bytes], Optional[str]]:
        """
        get model provider icon.

        :param provider: provider name
        :param icon_type: icon type (icon_small or icon_large)
        :param lang: language (zh_Hans or en_US)
        :return:
        """
        provider_instance = model_provider_factory.get_provider_instance(provider)
        provider_schema = provider_instance.get_provider_schema()

        if icon_type.lower() == 'icon_small':
            if not provider_schema.icon_small:
                raise ValueError(f"Provider {provider} does not have small icon.")

            if lang.lower() == 'zh_hans':
                file_name = provider_schema.icon_small.zh_Hans
            else:
                file_name = provider_schema.icon_small.en_US
        else:
            if not provider_schema.icon_large:
                raise ValueError(f"Provider {provider} does not have large icon.")

            if lang.lower() == 'zh_hans':
                file_name = provider_schema.icon_large.zh_Hans
            else:
                file_name = provider_schema.icon_large.en_US

        root_path = current_app.root_path
        provider_instance_path = os.path.dirname(os.path.join(root_path, provider_instance.__class__.__module__.replace('.', '/')))
        file_path = os.path.join(provider_instance_path, "_assets")
        file_path = os.path.join(file_path, file_name)

        if not os.path.exists(file_path):
            return None, None

        mimetype, _ = mimetypes.guess_type(file_path)
        mimetype = mimetype or 'application/octet-stream'

        # read binary from file
        with open(file_path, 'rb') as f:
            byte_data = f.read()
            return byte_data, mimetype

    def switch_preferred_provider(self, tenant_id: str, provider: str, preferred_provider_type: str) -> None:
        """
        switch preferred provider.

        :param tenant_id: workspace id
        :param provider: provider name
        :param preferred_provider_type: preferred provider type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Convert preferred_provider_type to ProviderType
        preferred_provider_type_enum = ProviderType.value_of(preferred_provider_type)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Switch preferred provider type
        provider_configuration.switch_preferred_provider_type(preferred_provider_type_enum)

    def enable_model(self, tenant_id: str, provider: str, model: str, model_type: str) -> None:
        """
        enable model.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Enable model
        provider_configuration.enable_model(
            model=model,
            model_type=ModelType.value_of(model_type)
        )

    def disable_model(self, tenant_id: str, provider: str, model: str, model_type: str) -> None:
        """
        disable model.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Enable model
        provider_configuration.disable_model(
            model=model,
            model_type=ModelType.value_of(model_type)
        )

    def free_quota_submit(self, tenant_id: str, provider: str):
        api_key = os.environ.get("FREE_QUOTA_APPLY_API_KEY")
        api_base_url = os.environ.get("FREE_QUOTA_APPLY_BASE_URL")
        api_url = api_base_url + '/api/v1/providers/apply'

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {api_key}"
        }
        response = requests.post(api_url, headers=headers, json={'workspace_id': tenant_id, 'provider_name': provider})
        if not response.ok:
            logger.error(f"Request FREE QUOTA APPLY SERVER Error: {response.status_code} ")
            raise ValueError(f"Error: {response.status_code} ")

        if response.json()["code"] != 'success':
            raise ValueError(
                f"error: {response.json()['message']}"
            )

        rst = response.json()

        if rst['type'] == 'redirect':
            return {
                'type': rst['type'],
                'redirect_url': rst['redirect_url']
            }
        else:
            return {
                'type': rst['type'],
                'result': 'success'
            }

    def free_quota_qualification_verify(self, tenant_id: str, provider: str, token: Optional[str]):
        api_key = os.environ.get("FREE_QUOTA_APPLY_API_KEY")
        api_base_url = os.environ.get("FREE_QUOTA_APPLY_BASE_URL")
        api_url = api_base_url + '/api/v1/providers/qualification-verify'

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {api_key}"
        }
        json_data = {'workspace_id': tenant_id, 'provider_name': provider}
        if token:
            json_data['token'] = token
        response = requests.post(api_url, headers=headers,
                                 json=json_data)
        if not response.ok:
            logger.error(f"Request FREE QUOTA APPLY SERVER Error: {response.status_code} ")
            raise ValueError(f"Error: {response.status_code} ")

        rst = response.json()
        if rst["code"] != 'success':
            raise ValueError(
                f"error: {rst['message']}"
            )

        data = rst['data']
        if data['qualified'] is True:
            return {
                'result': 'success',
                'provider_name': provider,
                'flag': True
            }
        else:
            return {
                'result': 'success',
                'provider_name': provider,
                'flag': False,
                'reason': data['reason']
            }
