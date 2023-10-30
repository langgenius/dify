import logging

import openai

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.moderation.base import BaseModeration
from core.model_providers.providers.base import BaseModelProvider

DEFAULT_MODEL = 'whisper-1'


class OpenAIModeration(BaseModeration):

    def __init__(self, model_provider: BaseModelProvider, name: str):
        super().__init__(model_provider, openai.Moderation, name)

    def _run(self, text: str) -> bool:
        credentials = self.model_provider.get_model_credentials(
            model_name=self.name,
            model_type=self.type
        )

        # 2000 text per chunk
        length = 2000
        text_chunks = [text[i:i + length] for i in range(0, len(text), length)]

        max_text_chunks = 32
        chunks = [text_chunks[i:i + max_text_chunks] for i in range(0, len(text_chunks), max_text_chunks)]

        for text_chunk in chunks:
            moderation_result = self._client.create(input=text_chunk,
                                                    api_key=credentials['openai_api_key'])

            for result in moderation_result.results:
                if result['flagged'] is True:
                    return False

        return True

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
            return LLMAuthorizationError(str(ex))
        elif isinstance(ex, openai.error.OpenAIError):
            return LLMBadRequestError(ex.__class__.__name__ + ":" + str(ex))
        else:
            return ex
