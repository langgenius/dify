import logging

import openai

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.speech2text.base import BaseSpeech2Text
from core.model_providers.providers.base import BaseModelProvider


class OpenAIWhisper(BaseSpeech2Text):

    def __init__(self, model_provider: BaseModelProvider, name: str):
        super().__init__(model_provider, openai.Audio, name)

    def _run(self, file):
        credentials = self.model_provider.get_model_credentials(
            model_name=self.name,
            model_type=self.type
        )

        return self._client.transcribe(
            model=self.name,
            file=file,
            api_key=credentials.get('openai_api_key'),
            api_base=credentials.get('openai_api_base'),
            organization=credentials.get('openai_organization'),
        )

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
