import decimal
import logging
from functools import wraps
from typing import List, Optional

import anthropic
from langchain.callbacks.manager import Callbacks
from langchain.chat_models import ChatAnthropic
from langchain.schema import LLMResult

from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs


def handle_anthropic_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except anthropic.APIConnectionError as e:
            logging.exception("Failed to connect to Anthropic API.")
            raise LLMAPIConnectionError(f"Anthropic: The server could not be reached, cause: {e.__cause__}")
        except anthropic.RateLimitError:
            raise LLMRateLimitError("Anthropic: A 429 status code was received; we should back off a bit.")
        except anthropic.AuthenticationError as e:
            raise LLMAuthorizationError(f"Anthropic: {e.message}")
        except anthropic.BadRequestError as e:
            raise LLMBadRequestError(f"Anthropic: {e.message}")
        except anthropic.APIStatusError as e:
            raise LLMAPIUnavailableError(f"Anthropic: code: {e.status_code}, cause: {e.message}")

    return wrapper


class AnthropicModel(BaseLLM):
    model_mode: ModelMode = ModelMode.CHAT

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
        client = ChatAnthropic(
            model=name,
            streaming=streaming,
            default_request_timeout=60,
            callbacks=callbacks,
            **credentials,
            **provider_model_kwargs
        )

        super().__init__(model_provider, client, name, model_rules, model_kwargs, streaming)

    @handle_anthropic_exceptions
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
        return max(self._client.get_num_tokens_from_messages(prompts) - len(prompts), 0)

    def get_token_price(self, tokens: int, message_type: MessageType):
        model_unit_prices = {
            'claude-instant-1': {
                'prompt': decimal.Decimal('1.63'),
                'completion': decimal.Decimal('5.51'),
            },
            'claude-2': {
                'prompt': decimal.Decimal('11.02'),
                'completion': decimal.Decimal('32.68'),
            },
        }

        if message_type == MessageType.HUMAN or message_type == MessageType.SYSTEM:
            unit_price = model_unit_prices[self.name]['prompt']
        else:
            unit_price = model_unit_prices[self.name]['completion']

        tokens_per_1m = (decimal.Decimal(tokens) / 1000000).quantize(decimal.Decimal('0.000001'),
                                                                     rounding=decimal.ROUND_HALF_UP)

        total_price = tokens_per_1m * unit_price
        return total_price.quantize(decimal.Decimal('0.00000001'), rounding=decimal.ROUND_HALF_UP)

    def get_currency(self):
        raise 'USD'
