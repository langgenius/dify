from typing import cast

from core.app.app_config.entities import EasyUIBasedAppConfig
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.model_entities import ModelStatus
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.provider_manager import ProviderManager


class ModelConfigConverter:
    @classmethod
    def convert(cls, app_config: EasyUIBasedAppConfig, skip_check: bool = False) -> ModelConfigWithCredentialsEntity:
        """
        Convert app model config dict to entity.
        :param app_config: app config
        :param skip_check: skip check
        :raises ProviderTokenNotInitError: provider token not init error
        :return: app orchestration config entity
        """
        model_config = app_config.model

        provider_manager = ProviderManager()
        provider_model_bundle = provider_manager.get_provider_model_bundle(
            tenant_id=app_config.tenant_id, provider=model_config.provider, model_type=ModelType.LLM
        )

        provider_name = provider_model_bundle.configuration.provider.provider
        model_name = model_config.model

        model_type_instance = provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        # check model credentials
        model_credentials = provider_model_bundle.configuration.get_current_credentials(
            model_type=ModelType.LLM, model=model_config.model
        )

        if model_credentials is None:
            if not skip_check:
                raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
            else:
                model_credentials = {}

        if not skip_check:
            # check model
            provider_model = provider_model_bundle.configuration.get_provider_model(
                model=model_config.model, model_type=ModelType.LLM
            )

            if provider_model is None:
                model_name = model_config.model
                raise ValueError(f"Model {model_name} not exist.")

            if provider_model.status == ModelStatus.NO_CONFIGURE:
                raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
            elif provider_model.status == ModelStatus.NO_PERMISSION:
                raise ModelCurrentlyNotSupportError(f"Dify Hosted OpenAI {model_name} currently not support.")
            elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
                raise QuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = model_config.parameters
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = model_config.mode
        if not model_mode:
            mode_enum = model_type_instance.get_model_mode(model=model_config.model, credentials=model_credentials)

            model_mode = mode_enum.value

        model_schema = model_type_instance.get_model_schema(model_config.model, model_credentials)

        if not skip_check and not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

        return ModelConfigWithCredentialsEntity(
            provider=model_config.provider,
            model=model_config.model,
            model_schema=model_schema,
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )
