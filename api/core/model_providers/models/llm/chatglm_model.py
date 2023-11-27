import logging
from typing import List, Optional, Any

import openai
from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult, get_buffer_string

from core.model_providers.error import LLMBadRequestError, LLMRateLimitError, LLMAuthorizationError, \
    LLMAPIUnavailableError, LLMAPIConnectionError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from core.third_party.langchain.llms.chat_open_ai import EnhanceChatOpenAI


class ChatGLMModel(BaseLLM):
    model_mode: ModelMode = ModelMode.CHAT

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)

        extra_model_kwargs = {
            'top_p': provider_model_kwargs.get('top_p')
        }

        if provider_model_kwargs.get('max_length') is not None:
            extra_model_kwargs['max_length'] = provider_model_kwargs.get('max_length')

        client = EnhanceChatOpenAI(
            model_name=self.name,
            temperature=provider_model_kwargs.get('temperature'),
            max_tokens=provider_model_kwargs.get('max_tokens'),
            model_kwargs=extra_model_kwargs,
            streaming=self.streaming,
            callbacks=self.callbacks,
            request_timeout=60,
            openai_api_key="1",
            openai_api_base=self.credentials['api_base'] + '/v1'
        )

        return client

    def _run(self, messages: List[PromptMessage],
             stop: Optional[List[str]] = None,
             callbacks: Callbacks = None,
             **kwargs) -> LLMResult:
        """
        run predict by prompt messages and stop words.

        :param messages:
        :param stop:
        :param callbacks:
        :return:
        """
        prompts = self._get_prompt_from_messages(messages)
        return self._client.generate([prompts], stop, callbacks)

    def get_num_tokens(self, messages: List[PromptMessage]) -> int:
        """
        get num tokens of prompt messages.

        :param messages:
        :return:
        """
        prompts = self._get_prompt_from_messages(messages)
        return max(sum([self._client.get_num_tokens(get_buffer_string([m])) for m in prompts]) - len(prompts), 0)

    def get_currency(self):
        return 'RMB'

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        extra_model_kwargs = {
            'top_p': provider_model_kwargs.get('top_p')
        }

        self.client.temperature = provider_model_kwargs.get('temperature')
        self.client.max_tokens = provider_model_kwargs.get('max_tokens')
        self.client.model_kwargs = extra_model_kwargs

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, openai.error.InvalidRequestError):
            logging.warning("Invalid request to ChatGLM API.")
            return LLMBadRequestError(str(ex))
        elif isinstance(ex, openai.error.APIConnectionError):
            logging.warning("Failed to connect to ChatGLM API.")
            return LLMAPIConnectionError(ex.__class__.__name__ + ":" + str(ex))
        elif isinstance(ex, (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout)):
            logging.warning("ChatGLM service unavailable.")
            return LLMAPIUnavailableError(ex.__class__.__name__ + ":" + str(ex))
        elif isinstance(ex, openai.error.RateLimitError):
            return LLMRateLimitError(str(ex))
        elif isinstance(ex, openai.error.AuthenticationError):
            return LLMAuthorizationError(str(ex))
        elif isinstance(ex, openai.error.OpenAIError):
            return LLMBadRequestError(ex.__class__.__name__ + ":" + str(ex))
        else:
            return ex

    @classmethod
    def support_streaming(cls):
        return True