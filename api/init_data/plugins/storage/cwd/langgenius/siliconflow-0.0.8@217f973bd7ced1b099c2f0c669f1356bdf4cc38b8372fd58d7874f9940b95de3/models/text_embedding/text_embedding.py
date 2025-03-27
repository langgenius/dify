from typing import Optional
from dify_plugin import OAICompatEmbeddingModel
from dify_plugin.entities.model import EmbeddingInputType
from dify_plugin.entities.model.text_embedding import TextEmbeddingResult


class SiliconflowTextEmbeddingModel(OAICompatEmbeddingModel):
    """
    Model class for Siliconflow text embedding model.
    """

    def validate_credentials(self, model: str, credentials: dict) -> None:
        self._add_custom_parameters(credentials)
        super().validate_credentials(model, credentials)

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
        self._add_custom_parameters(credentials)
        return super()._invoke(model, credentials, texts, user)

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        self._add_custom_parameters(credentials)
        return super().get_num_tokens(model, credentials, texts)

    @classmethod
    def _add_custom_parameters(cls, credentials: dict) -> None:
        credentials["endpoint_url"] = "https://api.siliconflow.cn/v1"
