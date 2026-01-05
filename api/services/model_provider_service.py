import logging

from core.entities.model_entities import ModelWithProviderEntity, ProviderModelWithStatusEntity
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
from services.errors.app_model_config import ProviderNotFoundError

logger = logging.getLogger(__name__)


class ModelProviderService:
    """
    Model Provider Service
    """

    def __init__(self):
        self.provider_manager = ProviderManager()

    def _get_provider_configuration(self, tenant_id: str, provider: str):
        """
        Get provider configuration or raise exception if not found.

        Args:
            tenant_id: Workspace identifier
            provider: Provider name

        Returns:
            Provider configuration instance

        Raises:
            ProviderNotFoundError: If provider doesn't exist
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)
        provider_configuration = provider_configurations.get(provider)

        if not provider_configuration:
            raise ProviderNotFoundError(f"Provider {provider} does not exist.")

        return provider_configuration

    def get_provider_list(self, tenant_id: str, model_type: str | None = None) -> list[ProviderResponse]:
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

            provider_config = provider_configuration.custom_configuration.provider
            models = provider_configuration.custom_configuration.models
            can_added_models = provider_configuration.custom_configuration.can_added_models

            # IMPORTANT: Never expose decrypted credentials in the provider list API.
            # Sanitize custom model configurations by dropping the credentials payload.
            sanitized_model_config = []
            if models:
                from core.entities.provider_entities import CustomModelConfiguration  # local import to avoid cycles

                for model in models:
                    sanitized_model_config.append(
                        CustomModelConfiguration(
                            model=model.model,
                            model_type=model.model_type,
                            credentials=None,  # strip secrets from list view
                            current_credential_id=model.current_credential_id,
                            current_credential_name=model.current_credential_name,
                            available_model_credentials=model.available_model_credentials,
                            unadded_to_model_list=model.unadded_to_model_list,
                        )
                    )

            provider_response = ProviderResponse(
                tenant_id=tenant_id,
                provider=provider_configuration.provider.provider,
                label=provider_configuration.provider.label,
                description=provider_configuration.provider.description,
                icon_small=provider_configuration.provider.icon_small,
                icon_small_dark=provider_configuration.provider.icon_small_dark,
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
                    else CustomConfigurationStatus.NO_CONFIGURE,
                    current_credential_id=getattr(provider_config, "current_credential_id", None),
                    current_credential_name=getattr(provider_config, "current_credential_name", None),
                    available_credentials=getattr(provider_config, "available_credentials", []),
                    custom_models=sanitized_model_config,
                    can_added_models=can_added_models,
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

        :param tenant_id: workspace id
        :param provider: provider name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider available models
        return [
            ModelWithProviderEntityResponse(tenant_id=tenant_id, model=model)
            for model in provider_configurations.get_models(provider=provider)
        ]

    def get_provider_credential(self, tenant_id: str, provider: str, credential_id: str | None = None) -> dict | None:
        """
        get provider credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credential_id: credential id, if not provided, return current used credentials
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        return provider_configuration.get_provider_credential(credential_id=credential_id)

    def validate_provider_credentials(self, tenant_id: str, provider: str, credentials: dict):
        """
        validate provider credentials before saving.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials dict
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.validate_provider_credentials(credentials)

    def create_provider_credential(
        self, tenant_id: str, provider: str, credentials: dict, credential_name: str | None
    ) -> None:
        """
        Create and save new provider credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials dict
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.create_provider_credential(credentials, credential_name)

    def update_provider_credential(
        self,
        tenant_id: str,
        provider: str,
        credentials: dict,
        credential_id: str,
        credential_name: str | None,
    ) -> None:
        """
        update a saved provider credential (by credential_id).

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials dict
        :param credential_id: credential id
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.update_provider_credential(
            credential_id=credential_id,
            credentials=credentials,
            credential_name=credential_name,
        )

    def remove_provider_credential(self, tenant_id: str, provider: str, credential_id: str):
        """
        remove a saved provider credential (by credential_id).
        :param tenant_id: workspace id
        :param provider: provider name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.delete_provider_credential(credential_id=credential_id)

    def switch_active_provider_credential(self, tenant_id: str, provider: str, credential_id: str):
        """
        :param tenant_id: workspace id
        :param provider: provider name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.switch_active_provider_credential(credential_id=credential_id)

    def get_model_credential(
        self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str | None
    ) -> dict | None:
        """
        Retrieve model-specific credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: Optional credential ID, uses current if not provided
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        return provider_configuration.get_custom_model_credential(
            model_type=ModelType.value_of(model_type), model=model, credential_id=credential_id
        )

    def validate_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict):
        """
        validate model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.validate_custom_model_credentials(
            model_type=ModelType.value_of(model_type), model=model, credentials=credentials
        )

    def create_model_credential(
        self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict, credential_name: str | None
    ) -> None:
        """
        create and save model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.create_custom_model_credential(
            model_type=ModelType.value_of(model_type),
            model=model,
            credentials=credentials,
            credential_name=credential_name,
        )

    def update_model_credential(
        self,
        tenant_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict,
        credential_id: str,
        credential_name: str | None,
    ) -> None:
        """
        update model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :param credential_id: credential id
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.update_custom_model_credential(
            model_type=ModelType.value_of(model_type),
            model=model,
            credentials=credentials,
            credential_id=credential_id,
            credential_name=credential_name,
        )

    def remove_model_credential(self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str):
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.delete_custom_model_credential(
            model_type=ModelType.value_of(model_type), model=model, credential_id=credential_id
        )

    def switch_active_custom_model_credential(
        self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str
    ):
        """
        switch model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.switch_custom_model_credential(
            model_type=ModelType.value_of(model_type), model=model, credential_id=credential_id
        )

    def add_model_credential_to_model_list(
        self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str
    ):
        """
        add model credentials to model list.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.add_model_credential_to_model(
            model_type=ModelType.value_of(model_type), model=model, credential_id=credential_id
        )

    def remove_model(self, tenant_id: str, provider: str, model_type: str, model: str):
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.delete_custom_model(model_type=ModelType.value_of(model_type), model=model)

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
        models = provider_configurations.get_models(model_type=ModelType.value_of(model_type), only_active=True)

        # Group models by provider
        provider_models: dict[str, list[ModelWithProviderEntity]] = {}
        for model in models:
            if model.provider.provider not in provider_models:
                provider_models[model.provider.provider] = []

            if model.deprecated:
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
                    icon_small_dark=first_model.provider.icon_small_dark,
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
        provider_configuration = self._get_provider_configuration(tenant_id, provider)

        # fetch credentials
        credentials = provider_configuration.get_current_credentials(model_type=ModelType.LLM, model=model)

        if not credentials:
            return []

        model_schema = provider_configuration.get_model_schema(
            model_type=ModelType.LLM, model=model, credentials=credentials
        )

        return model_schema.parameter_rules if model_schema else []

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> DefaultModelResponse | None:
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
                        supported_model_types=result.provider.supported_model_types,
                    ),
                )
                if result
                else None
            )
        except Exception as e:
            logger.debug("get_default_model_of_model_type error: %s", e)
            return None

    def update_default_model_of_model_type(self, tenant_id: str, model_type: str, provider: str, model: str):
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
    ) -> tuple[bytes | None, str | None]:
        """
        get model provider icon.

        :param tenant_id: workspace id
        :param provider: provider name
        :param icon_type: icon type (icon_small or icon_small_dark)
        :param lang: language (zh_Hans or en_US)
        :return:
        """
        model_provider_factory = ModelProviderFactory(tenant_id)
        byte_data, mime_type = model_provider_factory.get_provider_icon(provider, icon_type, lang)

        return byte_data, mime_type

    def switch_preferred_provider(self, tenant_id: str, provider: str, preferred_provider_type: str):
        """
        switch preferred provider.

        :param tenant_id: workspace id
        :param provider: provider name
        :param preferred_provider_type: preferred provider type
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)

        # Convert preferred_provider_type to ProviderType
        preferred_provider_type_enum = ProviderType.value_of(preferred_provider_type)

        # Switch preferred provider type
        provider_configuration.switch_preferred_provider_type(preferred_provider_type_enum)

    def enable_model(self, tenant_id: str, provider: str, model: str, model_type: str):
        """
        enable model.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.enable_model(model=model, model_type=ModelType.value_of(model_type))

    def disable_model(self, tenant_id: str, provider: str, model: str, model_type: str):
        """
        disable model.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.disable_model(model=model, model_type=ModelType.value_of(model_type))
