from typing import Optional

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.text_embedding_entities import (
    TextEmbeddingResult,
)
from core.model_runtime.model_providers.openai_api_compatible.text_embedding.text_embedding import (
    OAICompatEmbeddingModel,
)


class GPUStackTextEmbeddingModel(OAICompatEmbeddingModel):
    """
    Model class for GPUStack text embedding model.
    """

    def _invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str],
        user: Optional[str] = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> TextEmbeddingResult:
        compatible_credentials = self._get_compatible_credentials(credentials)
        return super()._invoke(model, compatible_credentials, texts, user, input_type)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        compatible_credentials = self._get_compatible_credentials(credentials)
        super().validate_credentials(model, compatible_credentials)

    def _get_compatible_credentials(self, credentials: dict) -> dict:
        credentials = credentials.copy()
        base_url = credentials["endpoint_url"].rstrip("/").removesuffix("/v1-openai")
        credentials["endpoint_url"] = f"{base_url}/v1-openai"
        return credentials
