import logging
from typing import Optional

from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, ProviderModelWithStatusEntity
from core.model_runtime.entities.model_entities import ModelType, ParameterRule
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
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
                tenant_id=tenant_id,
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
                    quota_configurations=provider_configuration.system_configuration.quota_configurations,
                ),
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
        return [
            ModelWithProviderEntityResponse(tenant_id=tenant_id, model=model)
            for model in provider_configurations.get_models(provider=provider)
        ]

    def get_provider_credentials(self, tenant_id: str, provider: str) -> Optional[dict]:
        """
        get provider credentials.
        """
        provider_configurations = self.provider_manager.get_configurations(tenant_id)
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

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

    def get_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> Optional[dict]:
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
            model_type=ModelType.value_of(model_type), model=model, obfuscated=True
        )

    def model_credentials_validate(
        self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict
    ) -> None:
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
            model_type=ModelType.value_of(model_type), model=model, credentials=credentials
        )

    def save_model_credentials(
        self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict
    ) -> None:
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
            model_type=ModelType.value_of(model_type), model=model, credentials=credentials
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
        provider_configuration.delete_custom_model_credentials(model_type=ModelType.value_of(model_type), model=model)

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
        models = provider_configurations.get_models(model_type=ModelType.value_of(model_type))

        # Group models by provider
        provider_models: dict[str, list[ModelWithProviderEntity]] = {}
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
                    tenant_id=tenant_id,
                    provider=provider,
                    label=first_model.provider.label,
                    icon_small=first_model.provider.icon_small,
                    icon_large=first_model.provider.icon_large,
                    status=CustomConfigurationStatus.ACTIVE,
                    models=[
                        ProviderModelWithStatusEntity(
                            model=model.model,
                            label=model.label,
                            model_type=model.model_type,
                            features=model.features,
                            fetch_from=model.fetch_from,
                            model_properties=model.model_properties,
                            status=model.status,
                            load_balancing_enabled=model.load_balancing_enabled,
                        )
                        for model in models
                    ],
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

        # fetch credentials
        credentials = provider_configuration.get_current_credentials(model_type=ModelType.LLM, model=model)

        if not credentials:
            return []

        model_schema = provider_configuration.get_model_schema(
            model_type=ModelType.LLM, model=model, credentials=credentials
        )

        return model_schema.parameter_rules if model_schema else []

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> Optional[DefaultModelResponse]:
        """
        get default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        model_type_enum = ModelType.value_of(model_type)

        try:
            result = self.provider_manager.get_default_model(tenant_id=tenant_id, model_type=model_type_enum)
            return (
                DefaultModelResponse(
                    model=result.model,
                    model_type=result.model_type,
                    provider=SimpleProviderEntityResponse(
                        tenant_id=tenant_id,
                        provider=result.provider.provider,
                        label=result.provider.label,
                        icon_small=result.provider.icon_small,
                        icon_large=result.provider.icon_large,
                        supported_model_types=result.provider.supported_model_types,
                    ),
                )
                if result
                else None
            )
        except Exception as e:
            logger.debug(f"get_default_model_of_model_type error: {e}")
            return None

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
            tenant_id=tenant_id, model_type=model_type_enum, provider=provider, model=model
        )

    def get_model_provider_icon(
        self, tenant_id: str, provider: str, icon_type: str, lang: str
    ) -> tuple[Optional[bytes], Optional[str]]:
        """
        get model provider icon.

        :param tenant_id: workspace id
        :param provider: provider name
        :param icon_type: icon type (icon_small or icon_large)
        :param lang: language (zh_Hans or en_US)
        :return:
        """
        model_provider_factory = ModelProviderFactory(tenant_id)
        byte_data, mime_type = model_provider_factory.get_provider_icon(provider, icon_type, lang)

        return byte_data, mime_type

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
        provider_configuration.enable_model(model=model, model_type=ModelType.value_of(model_type))

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
        provider_configuration.disable_model(model=model, model_type=ModelType.value_of(model_type))
