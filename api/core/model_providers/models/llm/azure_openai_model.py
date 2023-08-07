import decimal
import logging
from functools import wraps
from typing import List, Optional

import openai
from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult

from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.azure_chat_open_ai import EnhanceAzureChatOpenAI
from core.third_party.langchain.llms.azure_open_ai import EnhanceAzureOpenAI
from core.third_party.langchain.llms.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs

AZURE_OPENAI_API_VERSION = '2023-07-01-preview'


def handle_azure_openai_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except openai.error.InvalidRequestError as e:
            logging.exception("Invalid request to Azure OpenAI API.")
            raise LLMBadRequestError(str(e))
        except openai.error.APIConnectionError as e:
            logging.exception("Failed to connect to Azure OpenAI API.")
            raise LLMAPIConnectionError(e.__class__.__name__ + ":" + str(e))
        except (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout) as e:
            logging.exception("Azure OpenAI service unavailable.")
            raise LLMAPIUnavailableError(e.__class__.__name__ + ":" + str(e))
        except openai.error.RateLimitError as e:
            raise LLMRateLimitError('Azure ' + str(e))
        except openai.error.AuthenticationError as e:
            raise LLMAuthorizationError('Azure ' + str(e))
        except openai.error.OpenAIError as e:
            raise LLMBadRequestError('Azure ' + e.__class__.__name__ + ":" + str(e))

    return wrapper


class AzureOpenAIModel(BaseLLM):
    def __init__(self, model_provider: BaseModelProvider,
                 name: str,
                 model_kwargs: ModelKwargs,
                 streaming: bool = False,
                 callbacks: Callbacks = None):
        credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        model_rules = model_provider.get_model_parameter_rules(name, self.type)
        provider_model_kwargs = self._to_model_kwargs_input(model_rules, model_kwargs)

        if name == 'text-davinci-003':
            self.model_mode = ModelMode.COMPLETION
            client = EnhanceAzureOpenAI(
                deployment_name=name,
                streaming=streaming,
                request_timeout=60,
                openai_api_type='azure',
                openai_api_version=AZURE_OPENAI_API_VERSION,
                openai_api_key=credentials.get('openai_api_key'),
                openai_api_base=credentials.get('openai_api_base'),
                callbacks=callbacks,
                **provider_model_kwargs
            )
        else:
            self.model_mode = ModelMode.CHAT
            extra_model_kwargs = {
                'top_p': provider_model_kwargs.get('top_p'),
                'frequency_penalty': provider_model_kwargs.get('frequency_penalty'),
                'presence_penalty': provider_model_kwargs.get('presence_penalty'),
            }

            client = EnhanceAzureChatOpenAI(
                deployment_name=name,
                temperature=provider_model_kwargs.get('temperature'),
                max_tokens=provider_model_kwargs.get('max_tokens'),
                model_kwargs=extra_model_kwargs,
                streaming=streaming,
                request_timeout=60,
                openai_api_type='azure',
                openai_api_version=AZURE_OPENAI_API_VERSION,
                openai_api_key=credentials.get('openai_api_key'),
                openai_api_base=credentials.get('openai_api_base'),
                callbacks=callbacks,
            )

        super().__init__(model_provider, client, name, model_rules, model_kwargs, streaming)

    @handle_azure_openai_exceptions
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
            return max(self._client.get_num_tokens_from_messages(prompts) - len(prompts), 0)

    def get_token_price(self, tokens: int, message_type: MessageType):
        model_unit_prices = {
            'gpt-4': {
                'prompt': decimal.Decimal('0.03'),
                'completion': decimal.Decimal('0.06'),
            },
            'gpt-4-32k': {
                'prompt': decimal.Decimal('0.06'),
                'completion': decimal.Decimal('0.12')
            },
            'gpt-3.5-turbo': {
                'prompt': decimal.Decimal('0.0015'),
                'completion': decimal.Decimal('0.002')
            },
            'gpt-3.5-turbo-16k': {
                'prompt': decimal.Decimal('0.003'),
                'completion': decimal.Decimal('0.004')
            },
            'text-davinci-003': {
                'prompt': decimal.Decimal('0.02'),
                'completion': decimal.Decimal('0.02')
            },
        }

        if message_type == MessageType.HUMAN or message_type == MessageType.SYSTEM:
            unit_price = model_unit_prices[self.name]['prompt']
        else:
            unit_price = model_unit_prices[self.name]['completion']

        tokens_per_1k = (decimal.Decimal(tokens) / 1000).quantize(decimal.Decimal('0.001'),
                                                                  rounding=decimal.ROUND_HALF_UP)

        total_price = tokens_per_1k * unit_price
        return total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

    def get_currency(self):
        raise 'USD'
