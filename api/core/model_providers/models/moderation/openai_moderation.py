import logging

import openai

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider

DEFAULT_AUDIO_MODEL = 'whisper-1'


class OpenAIModeration(BaseProviderModel):
    type: ModelType = ModelType.MODERATION

    def __init__(self, model_provider: BaseModelProvider, name: str):
        super().__init__(model_provider, openai.Moderation)

    def run(self, text):
        credentials = self.model_provider.get_model_credentials(
            model_name=DEFAULT_AUDIO_MODEL,
            model_type=self.type
        )

        try:
            return self._client.create(input=text, api_key=credentials['openai_api_key'])
        except Exception as ex:
            raise self.handle_exceptions(ex)

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
