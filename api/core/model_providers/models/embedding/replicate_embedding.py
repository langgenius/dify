import decimal

from replicate.exceptions import ModelError, ReplicateError

from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.embeddings.replicate_embedding import ReplicateEmbeddings
from core.model_providers.models.embedding.base import BaseEmbedding


class ReplicateEmbedding(BaseEmbedding):
    def __init__(self, model_provider: BaseModelProvider, name: str):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = ReplicateEmbeddings(
            model=name + ':' + credentials.get('model_version'),
            replicate_api_token=credentials.get('replicate_api_token')
        )

        super().__init__(model_provider, client, name)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, (ModelError, ReplicateError)):
            return LLMBadRequestError(f"Replicate: {str(ex)}")
        else:
            return ex
