import decimal
from typing import List, Optional, Any

from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult

from core.model_providers.error import LLMBadRequestError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from core.third_party.langchain.llms.wenxin import Wenxin


class WenxinModel(BaseLLM):
    model_mode: ModelMode = ModelMode.COMPLETION

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        return Wenxin(
            streaming=self.streaming,
            callbacks=self.callbacks,
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
        return max(self._client.get_num_tokens(prompts), 0)

    def get_token_price(self, tokens: int, message_type: MessageType):
        model_unit_prices = {
            'ernie-bot': {
                'prompt': decimal.Decimal('0.012'),
                'completion': decimal.Decimal('0.012'),
            },
            'ernie-bot-turbo': {
                'prompt': decimal.Decimal('0.008'),
                'completion': decimal.Decimal('0.008')
            },
            'bloomz-7b': {
                'prompt': decimal.Decimal('0.006'),
                'completion': decimal.Decimal('0.006')
            }
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
        return 'RMB'

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        for k, v in provider_model_kwargs.items():
            if hasattr(self.client, k):
                setattr(self.client, k, v)

    def handle_exceptions(self, ex: Exception) -> Exception:
        return LLMBadRequestError(f"Wenxin: {str(ex)}")

    @classmethod
    def support_streaming(cls):
        return False
