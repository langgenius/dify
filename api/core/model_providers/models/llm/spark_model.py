import decimal
from functools import wraps
from typing import List, Optional

from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult

from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.error import LLMBadRequestError
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelMode, ModelKwargs
from core.third_party.langchain.llms.spark import ChatSpark
from core.third_party.spark.spark_llm import SparkError


def handle_spark_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except SparkError as e:
            raise LLMBadRequestError(f"Spark: {str(e)}")

    return wrapper


class SparkModel(BaseLLM):
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
        client = ChatSpark(
            streaming=streaming,
            callbacks=callbacks,
            **credentials,
            **provider_model_kwargs
        )

        super().__init__(model_provider, client, name, model_rules, model_kwargs, streaming)

    @handle_spark_exceptions
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

    def get_token_price(self, tokens: int, message_type: MessageType):
        return decimal.Decimal('0')

    def get_currency(self):
        raise 'RMB'
