import logging
from typing import List, Optional, Any

import openai
from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult, get_buffer_string

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.chat_open_ai import EnhanceChatOpenAI
from core.third_party.langchain.llms.open_ai import EnhanceOpenAI
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs


class LocalAIModel(BaseLLM):
    def __init__(self, model_provider: BaseModelProvider,
                 name: str,
                 model_kwargs: ModelKwargs,
                 streaming: bool = False,
                 callbacks: Callbacks = None):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        if credentials['completion_type'] == 'chat_completion':
            self.model_mode = ModelMode.CHAT
        else:
            self.model_mode = ModelMode.COMPLETION

        super().__init__(model_provider, name, model_kwargs, streaming, callbacks)

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        if self.model_mode == ModelMode.COMPLETION:
            client = EnhanceOpenAI(
                model_name=self.name,
                streaming=self.streaming,
                callbacks=self.callbacks,
                request_timeout=60,
                openai_api_key="1",
                openai_api_base=self.credentials['server_url'] + '/v1',
                **provider_model_kwargs
            )
        else:
            extra_model_kwargs = {
                'top_p': provider_model_kwargs.get('top_p')
            }

            client = EnhanceChatOpenAI(
                model_name=self.name,
                temperature=provider_model_kwargs.get('temperature'),
                max_tokens=provider_model_kwargs.get('max_tokens'),
                model_kwargs=extra_model_kwargs,
                streaming=self.streaming,
                callbacks=self.callbacks,
                request_timeout=60,
                openai_api_key="1",
                openai_api_base=self.credentials['server_url'] + '/v1'
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
        if isinstance(prompts, str):
            return self._client.get_num_tokens(prompts)
        else:
            return max(sum([self._client.get_num_tokens(get_buffer_string([m])) for m in prompts]) - len(prompts), 0)

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        if self.model_mode == ModelMode.COMPLETION:
            for k, v in provider_model_kwargs.items():
                if hasattr(self.client, k):
                    setattr(self.client, k, v)
        else:
            extra_model_kwargs = {
                'top_p': provider_model_kwargs.get('top_p')
            }

            self.client.temperature = provider_model_kwargs.get('temperature')
            self.client.max_tokens = provider_model_kwargs.get('max_tokens')
            self.client.model_kwargs = extra_model_kwargs

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, openai.error.InvalidRequestError):
            logging.warning("Invalid request to LocalAI API.")
            return LLMBadRequestError(str(ex))
        elif isinstance(ex, openai.error.APIConnectionError):
            logging.warning("Failed to connect to LocalAI API.")
            return LLMAPIConnectionError(ex.__class__.__name__ + ":" + str(ex))
        elif isinstance(ex, (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout)):
            logging.warning("LocalAI service unavailable.")
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
