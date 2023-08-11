import decimal
from functools import wraps
from typing import List, Optional, Any

from langchain import HuggingFaceHub
from langchain.callbacks.manager import Callbacks
from langchain.llms import HuggingFaceEndpoint
from langchain.schema import LLMResult

from core.model_providers.error import LLMBadRequestError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs


class HuggingfaceHubModel(BaseLLM):
    model_mode: ModelMode = ModelMode.COMPLETION

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        if self.credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            client = HuggingFaceEndpoint(
                endpoint_url=self.credentials['huggingfacehub_endpoint_url'],
                task='text2text-generation',
                model_kwargs=provider_model_kwargs,
                huggingfacehub_api_token=self.credentials['huggingfacehub_api_token'],
                callbacks=self.callbacks,
            )
        else:
            client = HuggingFaceHub(
                repo_id=self.name,
                task=self.credentials['task_type'],
                model_kwargs=provider_model_kwargs,
                huggingfacehub_api_token=self.credentials['huggingfacehub_api_token'],
                callbacks=self.callbacks,
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
        return self._client.get_num_tokens(prompts)

    def get_token_price(self, tokens: int, message_type: MessageType):
        # not support calc price
        return decimal.Decimal('0')

    def get_currency(self):
        return 'USD'

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        self.client.model_kwargs = provider_model_kwargs

    def handle_exceptions(self, ex: Exception) -> Exception:
        return LLMBadRequestError(f"Huggingface Hub: {str(ex)}")

    @classmethod
    def support_streaming(cls):
        return False

