from typing import Optional

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult
from core.model_runtime.model_providers.openai_api_compatible.text_embedding.text_embedding import (
    OAICompatEmbeddingModel,
)


class PerfXCloudEmbeddingModel(OAICompatEmbeddingModel):
    """
    Model class for an OpenAI API-compatible text embedding model.
    """

    def _invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str],
        user: Optional[str] = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> TextEmbeddingResult:
        """
        Invoke text embedding model

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :param input_type: input type
        :return: embeddings result
        """

        if "endpoint_url" not in credentials or credentials["endpoint_url"] == "":
            credentials["endpoint_url"] = "https://cloud.perfxlab.cn/v1/"

        return OAICompatEmbeddingModel._invoke(self, model, credentials, texts, user, input_type)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        if "endpoint_url" not in credentials or credentials["endpoint_url"] == "":
            credentials["endpoint_url"] = "https://cloud.perfxlab.cn/v1/"

        OAICompatEmbeddingModel.validate_credentials(self, model, credentials)
