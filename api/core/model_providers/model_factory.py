from typing import Optional

from langchain.callbacks.base import Callbacks

from core.errors.error import ProviderTokenNotInitError, LLMBadRequestError
from core.model_providers.model_provider_factory import ModelProviderFactory, DEFAULT_MODELS
from core.model_providers.models.entity.model_params import ModelKwargs, ModelType
from extensions.ext_database import db
from models.provider import TenantDefaultModel


class ModelFactory:

    @classmethod
    def get_embedding_model(cls,
                            tenant_id: str,
                            model_provider_name: Optional[str] = None,
                            model_name: Optional[str] = None):
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
    def get_reranking_model(cls,
                            tenant_id: str,
                            model_provider_name: Optional[str] = None,
                            model_name: Optional[str] = None):
        """
        get reranking model.

        :param tenant_id: a string representing the ID of the tenant.
        :param model_provider_name:
        :param model_name:
        :return:
        """
        if (model_provider_name is None or len(model_provider_name) == 0) and (model_name is None or len(model_name) == 0):
            default_model = cls.get_default_model(tenant_id, ModelType.RERANKING)

            if not default_model:
                raise LLMBadRequestError(f"Default model is not available. "
                                         f"Please configure a Default Reranking Model "
                                         f"in the Settings -> Model Provider.")

            model_provider_name = default_model.provider_name
            model_name = default_model.model_name

        # get model provider
        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)

        if not model_provider:
            raise ProviderTokenNotInitError(f"Model {model_name} provider credentials is not initialized.")

        # init reranking model
        model_class = model_provider.get_model_class(model_type=ModelType.RERANKING)
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


