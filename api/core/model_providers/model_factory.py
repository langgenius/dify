from typing import Optional

from langchain.callbacks.base import Callbacks

from core.model_providers.error import ProviderTokenNotInitError, LLMBadRequestError
from core.model_providers.model_provider_factory import ModelProviderFactory, DEFAULT_MODELS
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.embedding.base import BaseEmbedding
from core.model_providers.models.entity.model_params import ModelKwargs, ModelType
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.speech2text.base import BaseSpeech2Text
from extensions.ext_database import db
from models.provider import TenantDefaultModel


class ModelFactory:

    @classmethod
    def get_text_generation_model_from_model_config(cls, tenant_id: str,
                                                    model_config: dict,
                                                    streaming: bool = False,
                                                    callbacks: Callbacks = None) -> Optional[BaseLLM]:
        provider_name = model_config.get("provider")
        model_name = model_config.get("name")
        completion_params = model_config.get("completion_params", {})

        return cls.get_text_generation_model(
            tenant_id=tenant_id,
            model_provider_name=provider_name,
            model_name=model_name,
            model_kwargs=ModelKwargs(
                temperature=completion_params.get('temperature', 0),
                max_tokens=completion_params.get('max_tokens', 256),
                top_p=completion_params.get('top_p', 0),
                frequency_penalty=completion_params.get('frequency_penalty', 0.1),
                presence_penalty=completion_params.get('presence_penalty', 0.1)
            ),
            streaming=streaming,
            callbacks=callbacks
        )

    @classmethod
    def get_text_generation_model(cls,
                                  tenant_id: str,
                                  model_provider_name: Optional[str] = None,
                                  model_name: Optional[str] = None,
                                  model_kwargs: Optional[ModelKwargs] = None,
                                  streaming: bool = False,
                                  callbacks: Callbacks = None,
                                  deduct_quota: bool = True) -> Optional[BaseLLM]:
        """
        get text generation model.

        :param tenant_id: a string representing the ID of the tenant.
        :param model_provider_name:
        :param model_name:
        :param model_kwargs:
        :param streaming:
        :param callbacks:
        :param deduct_quota:
        :return:
        """
        is_default_model = False
        if model_provider_name is None and model_name is None:
            default_model = cls.get_default_model(tenant_id, ModelType.TEXT_GENERATION)

            if not default_model:
                raise LLMBadRequestError(f"Default model is not available. "
                                         f"Please configure a Default System Reasoning Model "
                                         f"in the Settings -> Model Provider.")

            model_provider_name = default_model.provider_name
            model_name = default_model.model_name
            is_default_model = True

        # get model provider
        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)

        if not model_provider:
            raise ProviderTokenNotInitError(f"Model {model_name} provider credentials is not initialized.")

        # init text generation model
        model_class = model_provider.get_model_class(model_type=ModelType.TEXT_GENERATION)

        try:
            model_instance = model_class(
                model_provider=model_provider,
                name=model_name,
                model_kwargs=model_kwargs,
                streaming=streaming,
                callbacks=callbacks
            )
        except LLMBadRequestError as e:
            if is_default_model:
                raise LLMBadRequestError(f"Default model {model_name} is not available. "
                                         f"Please check your model provider credentials.")
            else:
                raise e

        if is_default_model or not deduct_quota:
            model_instance.deduct_quota = False

        return model_instance

    @classmethod
    def get_embedding_model(cls,
                            tenant_id: str,
                            model_provider_name: Optional[str] = None,
                            model_name: Optional[str] = None) -> Optional[BaseEmbedding]:
        """
        get embedding model.

        :param tenant_id: a string representing the ID of the tenant.
        :param model_provider_name:
        :param model_name:
        :return:
        """
        if model_provider_name is None and model_name is None:
            default_model = cls.get_default_model(tenant_id, ModelType.EMBEDDINGS)

            if not default_model:
                raise LLMBadRequestError(f"Default model is not available. "
                                         f"Please configure a Default Embedding Model "
                                         f"in the Settings -> Model Provider.")

            model_provider_name = default_model.provider_name
            model_name = default_model.model_name

        # get model provider
        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)

        if not model_provider:
            raise ProviderTokenNotInitError(f"Model {model_name} provider credentials is not initialized.")

        # init embedding model
        model_class = model_provider.get_model_class(model_type=ModelType.EMBEDDINGS)
        return model_class(
            model_provider=model_provider,
            name=model_name
        )

    @classmethod
    def get_speech2text_model(cls,
                              tenant_id: str,
                              model_provider_name: Optional[str] = None,
                              model_name: Optional[str] = None) -> Optional[BaseSpeech2Text]:
        """
        get speech to text model.

        :param tenant_id: a string representing the ID of the tenant.
        :param model_provider_name:
        :param model_name:
        :return:
        """
        if model_provider_name is None and model_name is None:
            default_model = cls.get_default_model(tenant_id, ModelType.SPEECH_TO_TEXT)

            if not default_model:
                raise LLMBadRequestError(f"Default model is not available. "
                                         f"Please configure a Default Speech-to-Text Model "
                                         f"in the Settings -> Model Provider.")

            model_provider_name = default_model.provider_name
            model_name = default_model.model_name

        # get model provider
        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)

        if not model_provider:
            raise ProviderTokenNotInitError(f"Model {model_name} provider credentials is not initialized.")

        # init speech to text model
        model_class = model_provider.get_model_class(model_type=ModelType.SPEECH_TO_TEXT)
        return model_class(
            model_provider=model_provider,
            name=model_name
        )

    @classmethod
    def get_moderation_model(cls,
                             tenant_id: str,
                             model_provider_name: str,
                             model_name: str) -> Optional[BaseProviderModel]:
        """
        get moderation model.

        :param tenant_id: a string representing the ID of the tenant.
        :param model_provider_name:
        :param model_name:
        :return:
        """
        # get model provider
        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)

        if not model_provider:
            raise ProviderTokenNotInitError(f"Model {model_name} provider credentials is not initialized.")

        # init moderation model
        model_class = model_provider.get_model_class(model_type=ModelType.MODERATION)
        return model_class(
            model_provider=model_provider,
            name=model_name
        )

    @classmethod
    def get_default_model(cls, tenant_id: str, model_type: ModelType) -> TenantDefaultModel:
        """
        get default model of model type.

        :param tenant_id:
        :param model_type:
        :return:
        """
        # get default model
        default_model = db.session.query(TenantDefaultModel) \
            .filter(
            TenantDefaultModel.tenant_id == tenant_id,
            TenantDefaultModel.model_type == model_type.value
        ).first()

        if not default_model:
            model_provider_rules = ModelProviderFactory.get_provider_rules()
            for model_provider_name, model_provider_rule in model_provider_rules.items():
                model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)
                if not model_provider:
                    continue

                model_list = model_provider.get_supported_model_list(model_type)
                if model_list:
                    model_info = model_list[0]
                    default_model = TenantDefaultModel(
                        tenant_id=tenant_id,
                        model_type=model_type.value,
                        provider_name=model_provider_name,
                        model_name=model_info['id']
                    )
                    db.session.add(default_model)
                    db.session.commit()
                    break

        return default_model

    @classmethod
    def update_default_model(cls,
                             tenant_id: str,
                             model_type: ModelType,
                             provider_name: str,
                             model_name: str) -> TenantDefaultModel:
        """
        update default model of model type.

        :param tenant_id:
        :param model_type:
        :param provider_name:
        :param model_name:
        :return:
        """
        model_provider_name = ModelProviderFactory.get_provider_names()
        if provider_name not in model_provider_name:
            raise ValueError(f'Invalid provider name: {provider_name}')

        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, provider_name)

        if not model_provider:
            raise ProviderTokenNotInitError(f"Model {model_name} provider credentials is not initialized.")

        model_list = model_provider.get_supported_model_list(model_type)
        model_ids = [model['id'] for model in model_list]
        if model_name not in model_ids:
            raise ValueError(f'Invalid model name: {model_name}')

        # get default model
        default_model = db.session.query(TenantDefaultModel) \
            .filter(
            TenantDefaultModel.tenant_id == tenant_id,
            TenantDefaultModel.model_type == model_type.value
        ).first()

        if default_model:
            # update default model
            default_model.provider_name = provider_name
            default_model.model_name = model_name
            db.session.commit()
        else:
            # create default model
            default_model = TenantDefaultModel(
                tenant_id=tenant_id,
                model_type=model_type.value,
                provider_name=provider_name,
                model_name=model_name,
            )
            db.session.add(default_model)
            db.session.commit()

        return default_model
