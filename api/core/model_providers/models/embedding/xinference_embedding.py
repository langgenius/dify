from core.third_party.langchain.embeddings.xinference_embedding import XinferenceEmbedding as XinferenceEmbeddings
from replicate.exceptions import ModelError, ReplicateError

from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import BaseModelProvider
from core.model_providers.models.embedding.base import BaseEmbedding


class XinferenceEmbedding(BaseEmbedding):
    def __init__(self, model_provider: BaseModelProvider, name: str):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = XinferenceEmbeddings(
            server_url=credentials['server_url'],
            model_uid=credentials['model_uid'],
        )

        super().__init__(model_provider, client, name)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, (ModelError, ReplicateError)):
            return LLMBadRequestError(f"Xinference embedding: {str(ex)}")
        else:
            return ex
