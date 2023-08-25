from langchain.embeddings import MiniMaxEmbeddings

from core.model_providers.error import LLMBadRequestError
from core.model_providers.models.embedding.base import BaseEmbedding
from core.model_providers.providers.base import BaseModelProvider


class MinimaxEmbedding(BaseEmbedding):
    def __init__(self, model_provider: BaseModelProvider, name: str):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = MiniMaxEmbeddings(
            model=name,
            **credentials
        )

        super().__init__(model_provider, client, name)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, ValueError):
            return LLMBadRequestError(f"Minimax: {str(ex)}")
        else:
            return ex
