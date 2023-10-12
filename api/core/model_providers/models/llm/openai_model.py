import decimal
import logging
from typing import List, Optional, Any

import openai
from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult
from openai import api_requestor

from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.chat_open_ai import EnhanceChatOpenAI
from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError, ModelCurrentlyNotSupportError
from core.third_party.langchain.llms.open_ai import EnhanceOpenAI
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from models.provider import ProviderType, ProviderQuotaType

COMPLETION_MODELS = [
    'gpt-3.5-turbo-instruct',  # 4,096 tokens
    'text-davinci-003',  # 4,097 tokens
]

CHAT_MODELS = [
    'gpt-4',  # 8,192 tokens
    'gpt-4-32k',  # 32,768 tokens
    'gpt-3.5-turbo',  # 4,096 tokens
    'gpt-3.5-turbo-16k',  # 16,384 tokens
]

MODEL_MAX_TOKENS = {
    'gpt-4': 8192,
    'gpt-4-32k': 32768,
    'gpt-3.5-turbo': 4096,
    'gpt-3.5-turbo-instruct': 8192,
    'gpt-3.5-turbo-16k': 16384,
    'text-davinci-003': 4097,
}


class OpenAIModel(BaseLLM):
    def __init__(self, model_provider: BaseModelProvider,
                 name: str,
                 model_kwargs: ModelKwargs,
                 streaming: bool = False,
                 callbacks: Callbacks = None):
        if name in COMPLETION_MODELS:
            self.model_mode = ModelMode.COMPLETION
        else:
            self.model_mode = ModelMode.CHAT
        
        # TODO load price config from configs(db)
        super().__init__(model_provider, name, model_kwargs, streaming, callbacks)

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        if self.name in COMPLETION_MODELS:
            client = EnhanceOpenAI(
                model_name=self.name,
                streaming=self.streaming,
                callbacks=self.callbacks,
                request_timeout=60,
                **self.credentials,
                **provider_model_kwargs
            )
        else:
            # Fine-tuning is currently only available for the following base models:
            # davinci, curie, babbage, and ada.
            # This means that except for the fixed `completion` model,
            # all other fine-tuned models are `completion` models.
            extra_model_kwargs = {
                'top_p': provider_model_kwargs.get('top_p'),
                'frequency_penalty': provider_model_kwargs.get('frequency_penalty'),
                'presence_penalty': provider_model_kwargs.get('presence_penalty'),
            }

            client = EnhanceChatOpenAI(
                model_name=self.name,
                temperature=provider_model_kwargs.get('temperature'),
                max_tokens=provider_model_kwargs.get('max_tokens'),
                model_kwargs=extra_model_kwargs,
                streaming=self.streaming,
                callbacks=self.callbacks,
                request_timeout=60,
                **self.credentials
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
        if self.name == 'gpt-4' \
                and self.model_provider.provider.provider_type == ProviderType.SYSTEM.value \
                and self.model_provider.provider.quota_type == ProviderQuotaType.TRIAL.value:
            raise ModelCurrentlyNotSupportError("Dify Hosted OpenAI GPT-4 currently not support.")

        prompts = self._get_prompt_from_messages(messages)

        generate_kwargs = {
            'stop': stop,
            'callbacks': callbacks
        }

        if isinstance(prompts, str):
            generate_kwargs['prompts'] = [prompts]
        else:
            generate_kwargs['messages'] = [prompts]

        if 'functions' in kwargs:
            generate_kwargs['functions'] = kwargs['functions']

        return self._client.generate(**generate_kwargs)

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
            return max(self._client.get_num_tokens_from_messages(prompts) - len(prompts), 0)

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        if self.name in COMPLETION_MODELS:
            for k, v in provider_model_kwargs.items():
                if hasattr(self.client, k):
                    setattr(self.client, k, v)
        else:
            extra_model_kwargs = {
                'top_p': provider_model_kwargs.get('top_p'),
                'frequency_penalty': provider_model_kwargs.get('frequency_penalty'),
                'presence_penalty': provider_model_kwargs.get('presence_penalty'),
            }

            self.client.temperature = provider_model_kwargs.get('temperature')
            self.client.max_tokens = provider_model_kwargs.get('max_tokens')
            self.client.model_kwargs = extra_model_kwargs

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

    @property
    def support_streaming(self):
        return True

    # def is_model_valid_or_raise(self):
    #     """
    #     check is a valid model.
    #
    #     :return:
    #     """
    #     credentials = self._model_provider.get_credentials()
    #
    #     try:
    #         result = openai.Model.retrieve(
    #             id=self.name,
    #             api_key=credentials.get('openai_api_key'),
    #             request_timeout=60
    #         )
    #
    #         if 'id' not in result or result['id'] != self.name:
    #             raise LLMNotExistsError(f"OpenAI Model {self.name} not exists.")
    #     except openai.error.OpenAIError as e:
    #         raise LLMNotExistsError(f"OpenAI Model {self.name} not exists, cause: {e.__class__.__name__}:{str(e)}")
    #     except Exception as e:
    #         logging.exception("OpenAI Model retrieve failed.")
    #         raise e
