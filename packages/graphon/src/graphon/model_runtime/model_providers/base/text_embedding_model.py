from collections.abc import Mapping
from typing import Any

from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.entities.text_embedding_entities import (
    EmbeddingInputType,
    EmbeddingResult,
)
from graphon.model_runtime.model_providers.base.ai_model import AIModel
from graphon.model_runtime.protocols.text_embedding_runtime import (
    TextEmbeddingModelRuntime,
)


class TextEmbeddingModel(AIModel[TextEmbeddingModelRuntime]):
    """Model class for text embedding model."""

    model_type: ModelType = ModelType.TEXT_EMBEDDING

    def invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str] | None = None,
        multimodel_documents: list[dict[str, Any]] | None = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> EmbeddingResult:
        """Invoke text or multimodal embedding generation for the provided inputs."""
        if not texts and not multimodel_documents:
            msg = "No texts or files provided"
            raise ValueError(msg)

        if texts:
            try:
                return self.model_runtime.invoke_text_embedding(
                    provider=self.provider,
                    model=model,
                    credentials=credentials,
                    texts=texts,
                    input_type=input_type,
                    request_metadata=request_metadata,
                )
            except Exception as e:
                raise self._transform_invoke_error(e) from e

        if multimodel_documents is None:
            msg = "No multimodal documents provided"
            raise ValueError(msg)

        try:
            return self.model_runtime.invoke_multimodal_embedding(
                provider=self.provider,
                model=model,
                credentials=credentials,
                documents=multimodel_documents,
                input_type=input_type,
                request_metadata=request_metadata,
            )
        except Exception as e:
            raise self._transform_invoke_error(e) from e

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        texts: list[str],
    ) -> list[int]:
        """Count tokens for each text input sent to the embedding model."""
        return self.model_runtime.get_text_embedding_num_tokens(
            provider=self.provider,
            model=model,
            credentials=credentials,
            texts=texts,
        )

    def _get_context_size(self, model: str, credentials: dict) -> int:
        """Get the embedding model context size, falling back to the default."""
        model_schema = self.get_model_schema(model, credentials)

        if (
            model_schema
            and ModelPropertyKey.CONTEXT_SIZE in model_schema.model_properties
        ):
            content_size: int = model_schema.model_properties[
                ModelPropertyKey.CONTEXT_SIZE
            ]
            return content_size

        return 1000

    def _get_max_chunks(self, model: str, credentials: dict) -> int:
        """Get the maximum chunk count supported by the embedding model."""
        model_schema = self.get_model_schema(model, credentials)

        if (
            model_schema
            and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties
        ):
            max_chunks: int = model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]
            return max_chunks

        return 1
