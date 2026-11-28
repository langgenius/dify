from typing_extensions import TypedDict

from core.app.app_config.entities import EasyUIBasedAppConfig
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.model_entities import ModelStatus
from core.entities.provider_configuration import ProviderModelBundle, bind_model_route
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType


class ProviderCredentials(TypedDict):
    """The custom (BYOK) provider credentials the converter only checks for presence.

    Production-owned shape: tests import this instead of re-declaring an ad hoc dict.
    """

    api_key: str


class CompletionParameters(TypedDict, total=False, extra_items=object):
    """The completion parameters the converter splits into ``parameters`` and ``stop``.

    ``stop`` is peeled off into ``ModelConfigEntity.stop`` before the rest is forwarded to the
    model runtime; provider-specific parameters pass through unchanged (``extra_items``).
    Production-owned shape: tests import this instead of re-declaring an ad hoc dict.
    """

    temperature: float
    max_tokens: int
    stop: list[str]


class ModelConfigConverter:
    @classmethod
    def convert(
        cls,
        app_config: EasyUIBasedAppConfig,
        *,
        provider_model_bundle: ProviderModelBundle | None = None,
    ) -> ModelConfigWithCredentialsEntity:
        """
        Convert app model config to an entity with credentials and status from the same model route.
        :param app_config: app config
        :param provider_model_bundle: already resolved provider model bundle; when omitted the bundle is
            resolved from the tenant's provider configuration (the production path)
        :raises ProviderTokenNotInitError: provider token not init error
        :return: app orchestration config entity
        """
        model_config = app_config.model

        if provider_model_bundle is None:
            provider_manager = create_plugin_provider_manager(tenant_id=app_config.tenant_id)
            provider_model_bundle = provider_manager.get_provider_model_bundle(
                tenant_id=app_config.tenant_id, provider=model_config.provider, model_type=ModelType.LLM
            )
        provider_model_bundle = bind_model_route(provider_model_bundle, model_config.model)

        provider_name = provider_model_bundle.configuration.provider.provider
        model_name = model_config.model

        # ``get_model_schema`` is declared on the ``AIModel`` base class, so the bundle's model type
        # instance already carries the right type; no downcast to ``LargeLanguageModel`` is needed.
        model_type_instance = provider_model_bundle.model_type_instance

        # check model credentials
        model_credentials = provider_model_bundle.configuration.get_current_credentials(
            model_type=ModelType.LLM, model=model_config.model
        )

        if model_credentials is None:
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")

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

        model_schema = model_type_instance.get_model_schema(model_config.model, model_credentials)

        # get model mode
        model_mode = model_config.mode
        if not model_mode:
            model_mode = LLMMode.CHAT
            if model_schema and model_schema.model_properties.get(ModelPropertyKey.MODE):
                try:
                    model_mode = LLMMode(model_schema.model_properties[ModelPropertyKey.MODE])
                except ValueError:
                    # Fall back to CHAT mode if the stored value is invalid
                    model_mode = LLMMode.CHAT

        if not model_schema:
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
