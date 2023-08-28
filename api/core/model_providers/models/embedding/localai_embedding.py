from langchain.embeddings import LocalAIEmbeddings

from replicate.exceptions import ModelError, ReplicateError

from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import BaseModelProvider
from core.model_providers.models.embedding.base import BaseEmbedding


class LocalAIEmbedding(BaseEmbedding):
    def __init__(self, model_provider: BaseModelProvider, name: str):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = LocalAIEmbeddings(
            model=name,
            openai_api_key="1",
            openai_api_base=credentials['server_url'],
        )

        super().__init__(model_provider, client, name)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, (ModelError, ReplicateError)):
            return LLMBadRequestError(f"LocalAI embedding: {str(ex)}")
        else:
            return ex
