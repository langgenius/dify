import decimal
from typing import List, Optional, Any

from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult

from core.model_providers.error import LLMBadRequestError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from core.third_party.langchain.llms.spark import ChatSpark
from core.third_party.spark.spark_llm import SparkError


class SparkModel(BaseLLM):
    model_mode: ModelMode = ModelMode.CHAT

    def _init_client(self) -> Any:
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, self.model_kwargs)
        return ChatSpark(
            model_name=self.name,
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
        contents = [message.content for message in messages]
        return max(self._client.get_num_tokens("".join(contents)), 0)

    def get_currency(self):
        return 'RMB'

    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        provider_model_kwargs = self._to_model_kwargs_input(self.model_rules, model_kwargs)
        for k, v in provider_model_kwargs.items():
            if hasattr(self.client, k):
                setattr(self.client, k, v)

    def handle_exceptions(self, ex: Exception) -> Exception:
        if isinstance(ex, SparkError):
            return LLMBadRequestError(f"Spark: {str(ex)}")
        else:
            return ex

    @property
    def support_streaming(self):
        return True
