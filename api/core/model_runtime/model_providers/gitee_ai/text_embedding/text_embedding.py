from typing import Optional

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.model_providers.openai_api_compatible.text_embedding.text_embedding import (
    OAICompatEmbeddingModel,
)


class GiteeAIEmbeddingModel(OAICompatEmbeddingModel):
    def _invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str],
        user: Optional[str] = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> TextEmbeddingResult:
        self._add_custom_parameters(credentials, model)
        return super()._invoke(model, credentials, texts, user, input_type)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        self._add_custom_parameters(credentials, None)
        super().validate_credentials(model, credentials)

    @staticmethod
    def _add_custom_parameters(credentials: dict, model: str) -> None:
        if model is None:
            model = "bge-m3"

        credentials["endpoint_url"] = f"https://ai.gitee.com/api/serverless/{model}/v1/"
