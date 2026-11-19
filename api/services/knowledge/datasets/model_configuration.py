"""External model configuration gateway for knowledge use cases."""

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelInstance, ModelManager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from services.knowledge.entities.model_configuration import (
    DatasetModelConfiguration,
    EmbeddingModelConfiguration,
)


class KnowledgeModelConfigurationGateway:
    """Resolve and validate model configuration without owning persistence."""

    @staticmethod
    def _manager(tenant_id: str) -> ModelManager:
        return ModelManager.for_tenant(tenant_id=tenant_id)

    @staticmethod
    def _embedding_configuration(model: ModelInstance) -> EmbeddingModelConfiguration:
        schema = model.get_model_schema()
        return EmbeddingModelConfiguration(
            provider=model.provider,
            model=model.model_name,
            supports_vision=bool(schema.features and ModelFeature.VISION in schema.features),
        )

    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration:
        model = self._manager(tenant_id).get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.TEXT_EMBEDDING,
        )
        return self._embedding_configuration(model)

    def resolve_embedding_model(
        self,
        *,
        tenant_id: str,
        provider: str,
        model: str,
    ) -> EmbeddingModelConfiguration:
        try:
            instance = self._manager(tenant_id).get_model_instance(
                tenant_id=tenant_id,
                provider=provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=model,
            )
            return self._embedding_configuration(instance)
        except LLMBadRequestError as error:
            raise ValueError(
                "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
            ) from error

    def validate_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        try:
            self._manager(tenant_id).get_model_instance(
                tenant_id=tenant_id,
                provider=provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=model,
            )
        except LLMBadRequestError as error:
            raise ValueError(
                "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
            ) from error
        except ProviderTokenNotInitError as error:
            raise ValueError(error.description) from error

    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        try:
            self._manager(tenant_id).get_model_instance(
                tenant_id=tenant_id,
                provider=provider,
                model_type=ModelType.RERANK,
                model=model,
            )
        except LLMBadRequestError as error:
            raise ValueError(
                "No Rerank Model available. Please configure a valid provider in the Settings -> Model Provider."
            ) from error
        except ProviderTokenNotInitError as error:
            raise ValueError(error.description) from error

    def validate_dataset_model(
        self,
        *,
        configuration: DatasetModelConfiguration,
        dataset_unavailable: bool = True,
    ) -> None:
        if configuration.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return
        try:
            self._manager(configuration.tenant_id).get_model_instance(
                tenant_id=configuration.tenant_id,
                provider=configuration.embedding_model_provider or "",
                model_type=ModelType.TEXT_EMBEDDING,
                model=configuration.embedding_model or "",
            )
        except LLMBadRequestError as error:
            raise ValueError(
                "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
            ) from error
        except ProviderTokenNotInitError as error:
            description = error.description
            if dataset_unavailable:
                description = f"The dataset is unavailable, due to: {description}"
            raise ValueError(description) from error
