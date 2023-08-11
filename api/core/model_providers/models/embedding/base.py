from abc import abstractmethod
from typing import Any

import tiktoken
from langchain.schema.language_model import _get_token_ids_default_method

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider


class BaseEmbedding(BaseProviderModel):
    name: str
    type: ModelType = ModelType.EMBEDDINGS

    def __init__(self, model_provider: BaseModelProvider, client: Any, name: str):
        super().__init__(model_provider, client)
        self.name = name

    def get_num_tokens(self, text: str) -> int:
        """
        get num tokens of text.

        :param text:
        :return:
        """
        if len(text) == 0:
            return 0

        return len(_get_token_ids_default_method(text))

    def get_token_price(self, tokens: int):
        return 0

    def get_currency(self):
        return 'USD'

    @abstractmethod
    def handle_exceptions(self, ex: Exception) -> Exception:
        raise NotImplementedError
