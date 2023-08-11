import decimal
import logging

import openai
import tiktoken
from langchain.embeddings import OpenAIEmbeddings

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.embedding.base import BaseEmbedding
from core.model_providers.providers.base import BaseModelProvider


class OpenAIEmbedding(BaseEmbedding):
    def __init__(self, model_provider: BaseModelProvider, name: str):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = OpenAIEmbeddings(
            max_retries=1,
            **credentials
        )

        super().__init__(model_provider, client, name)

    def get_num_tokens(self, text: str) -> int:
        """
        get num tokens of text.

        :param text:
        :return:
        """
        if len(text) == 0:
            return 0

        enc = tiktoken.encoding_for_model(self.name)

        tokenized_text = enc.encode(text)

        # calculate the number of tokens in the encoded text
        return len(tokenized_text)

    def get_token_price(self, tokens: int):
        tokens_per_1k = (decimal.Decimal(tokens) / 1000).quantize(decimal.Decimal('0.001'),
                                                                  rounding=decimal.ROUND_HALF_UP)

        total_price = tokens_per_1k * decimal.Decimal('0.0001')
        return total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

    def get_currency(self):
        return 'USD'

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, openai.error.InvalidRequestError):
            logging.warning("Invalid request to OpenAI API.")
            return LLMBadRequestError(str(ex))
        elif isinstance(ex, openai.error.APIConnectionError):
            logging.warning("Failed to connect to OpenAI API.")
            return LLMAPIConnectionError(ex.__class__.__name__ + ":" + str(ex))
        elif isinstance(ex, (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout)):
            logging.warning("OpenAI service unavailable.")
            return LLMAPIUnavailableError(ex.__class__.__name__ + ":" + str(ex))
        elif isinstance(ex, openai.error.RateLimitError):
            return LLMRateLimitError(str(ex))
        elif isinstance(ex, openai.error.AuthenticationError):
            raise LLMAuthorizationError(str(ex))
        elif isinstance(ex, openai.error.OpenAIError):
            return LLMBadRequestError(ex.__class__.__name__ + ":" + str(ex))
        else:
            return ex
