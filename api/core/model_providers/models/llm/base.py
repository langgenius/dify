from abc import abstractmethod
from typing import List, Optional, Any, Union

from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult, SystemMessage, AIMessage, HumanMessage, BaseMessage, ChatGeneration

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.message import PromptMessage, MessageType, LLMRunResult
from core.model_providers.models.entity.model_params import ModelType, ModelKwargs, ModelMode, ModelKwargsRules
from core.model_providers.providers.base import BaseModelProvider


class BaseLLM(BaseProviderModel):
    model_mode: ModelMode = ModelMode.COMPLETION
    name: str
    model_kwargs: ModelKwargs
    streaming: bool = False
    type: ModelType = ModelType.TEXT_GENERATION
    deduct_quota: bool = True

    def __init__(self, model_provider: BaseModelProvider,
                 client: Any,
                 name: str,
                 model_rules: ModelKwargsRules,
                 model_kwargs: ModelKwargs,
                 streaming: bool = False):
        super().__init__(model_provider, client)

        self.name = name
        self.model_rules = model_rules
        self.model_kwargs = model_kwargs if model_kwargs else ModelKwargs(
            max_tokens=None,
            temperature=None,
            top_p=None,
            presence_penalty=None,
            frequency_penalty=None
        )
        self.streaming = streaming

    def run(self, messages: List[PromptMessage],
            stop: Optional[List[str]] = None,
            callbacks: Callbacks = None,
            **kwargs) -> LLMRunResult:
        """
        run predict by prompt messages and stop words.

        :param messages:
        :param stop:
        :param callbacks:
        :return:
        """
        if self.deduct_quota:
            self.model_provider.check_quota_over_limit()

        result = self._run(messages, stop, callbacks, **kwargs)

        if isinstance(result.generations[0][0], ChatGeneration):
            completion_content = result.generations[0][0].message.content
        else:
            completion_content=result.generations[0][0].text

        if result.llm_output:
            prompt_tokens = result.llm_output['token_usage']['prompt_tokens']
            completion_tokens = result.llm_output['token_usage']['completion_tokens']
            total_tokens = result.llm_output['token_usage']['total_tokens']
        else:
            prompt_tokens = self.get_num_tokens(messages)
            completion_tokens = self.get_num_tokens([PromptMessage(content=completion_content, type=MessageType.ASSISTANT)])
            total_tokens = prompt_tokens + completion_tokens

        if self.deduct_quota:
            self.model_provider.deduct_quota(total_tokens)

        return LLMRunResult(
            content=completion_content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens
        )

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def get_num_tokens(self, messages: List[PromptMessage]) -> int:
        """
        get num tokens of prompt messages.

        :param messages:
        :return:
        """
        raise NotImplementedError

    @abstractmethod
    def get_token_price(self, tokens: int, message_type: MessageType):
        """
        get token price.

        :param tokens:
        :param message_type:
        :return:
        """
        raise NotImplementedError

    @abstractmethod
    def get_currency(self):
        """
        get token currency.

        :return:
        """
        raise NotImplementedError

    def _get_prompt_from_messages(self, messages: List[PromptMessage]) -> Union[str | List[BaseMessage]]:
        if len(messages) == 0:
            raise ValueError("prompt must not be empty.")

        if self.model_mode == ModelMode.COMPLETION:
            return messages[0].content
        else:
            chat_messages = []
            for message in messages:
                if message.type == MessageType.HUMAN:
                    chat_messages.append(HumanMessage(content=message.content))
                elif message.type == MessageType.ASSISTANT:
                    chat_messages.append(AIMessage(content=message.content))
                elif message.type == MessageType.SYSTEM:
                    chat_messages.append(SystemMessage(content=message.content))

            return chat_messages

    def _to_model_kwargs_input(self, model_rules: ModelKwargsRules, model_kwargs: ModelKwargs) -> dict:
        """
        convert model kwargs to provider model kwargs.

        :param model_rules:
        :param model_kwargs:
        :return:
        """
        model_kwargs_input = {}
        for key, value in model_kwargs.dict().items():
            rule = getattr(model_rules, key)
            if not rule.enabled:
                continue

            if rule.alias:
                key = rule.alias

            if rule.default is not None and value is None:
                value = rule.default

            if rule.min is not None:
                value = max(value, rule.min)

            if rule.max is not None:
                value = min(value, rule.max)

            model_kwargs_input[key] = value

        return model_kwargs_input
