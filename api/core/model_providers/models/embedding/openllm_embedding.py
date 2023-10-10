from core.third_party.langchain.embeddings.openllm_embedding import OpenLLMEmbeddings

from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import BaseModelProvider
from core.model_providers.models.embedding.base import BaseEmbedding


class OpenLLMEmbedding(BaseEmbedding):
    def __init__(self, model_provider: BaseModelProvider, name: str):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = OpenLLMEmbeddings(
            server_url=credentials['server_url']
        )

        super().__init__(model_provider, client, name)

    def handle_exceptions(self, ex: Exception) -> Exception:
        return LLMBadRequestError(f"OpenLLM embedding: {str(ex)}")
