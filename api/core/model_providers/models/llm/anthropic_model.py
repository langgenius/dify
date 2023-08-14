import decimal
import logging
from functools import wraps
from typing import List, Optional, Any

import anthropic
from langchain.callbacks.manager import Callbacks
from langchain.chat_models import ChatAnthropic
from langchain.schema import LLMResult

from core.model_providers.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, \
    LLMRateLimitError, LLMAuthorizationError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs


class AnthropicModel(BaseLLM):
    model_mode: ModelMode = ModelMode.CHAT

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        return ChatAnthropic(
            model=self.name,
            streaming=self.streaming,
            callbacks=self.callbacks,
            default_request_timeout=60,
            **self.credentials,
            **provider_model_kwargs
        )

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
        return 'USD'

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        for k, v in provider_model_kwargs.items():
            if hasattr(self.client, k):
                setattr(self.client, k, v)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, anthropic.APIConnectionError):
            logging.warning("Failed to connect to Anthropic API.")
            return LLMAPIConnectionError(f"Anthropic: The server could not be reached, cause: {ex.__cause__}")
        elif isinstance(ex, anthropic.RateLimitError):
            return LLMRateLimitError("Anthropic: A 429 status code was received; we should back off a bit.")
        elif isinstance(ex, anthropic.AuthenticationError):
            return LLMAuthorizationError(f"Anthropic: {ex.message}")
        elif isinstance(ex, anthropic.BadRequestError):
            return LLMBadRequestError(f"Anthropic: {ex.message}")
        elif isinstance(ex, anthropic.APIStatusError):
            return LLMAPIUnavailableError(f"Anthropic: code: {ex.status_code}, cause: {ex.message}")
        else:
            return ex

    @classmethod
    def support_streaming(cls):
        return True

