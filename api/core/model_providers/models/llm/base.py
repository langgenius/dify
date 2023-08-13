from abc import abstractmethod
from typing import List, Optional, Any, Union

from langchain.callbacks.manager import Callbacks
from langchain.schema import LLMResult, SystemMessage, AIMessage, HumanMessage, BaseMessage, ChatGeneration

from core.callback_handler.std_out_callback_handler import DifyStreamingStdOutCallbackHandler, DifyStdOutCallbackHandler
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.message import PromptMessage, MessageType, LLMRunResult
from core.model_providers.models.entity.model_params import ModelType, ModelKwargs, ModelMode, ModelKwargsRules
from core.model_providers.providers.base import BaseModelProvider
from core.third_party.langchain.llms.fake import FakeLLM


class BaseLLM(BaseProviderModel):
    model_mode: ModelMode = ModelMode.COMPLETION
    name: str
    model_kwargs: ModelKwargs
    credentials: dict
    streaming: bool = False
    type: ModelType = ModelType.TEXT_GENERATION
    deduct_quota: bool = True

    def __init__(self, model_provider: BaseModelProvider,
                 name: str,
                 model_kwargs: ModelKwargs,
                 streaming: bool = False,
                 callbacks: Callbacks = None):
        self.name = name
        self.model_rules = model_provider.get_model_parameter_rules(name, self.type)
        self.model_kwargs = model_kwargs if model_kwargs else ModelKwargs(
            max_tokens=None,
            temperature=None,
            top_p=None,
            presence_penalty=None,
            frequency_penalty=None
        )
        self.credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )
        self.streaming = streaming

        if streaming:
            default_callback = DifyStreamingStdOutCallbackHandler()
        else:
            default_callback = DifyStdOutCallbackHandler()

        if not callbacks:
            callbacks = [default_callback]
        else:
            callbacks.append(default_callback)

        self.callbacks = callbacks

        client = self._init_client()
        super().__init__(model_provider, client)

    @abstractmethod
    def _init_client(self) -> Any:
        raise NotImplementedError

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

        if not callbacks:
            callbacks = self.callbacks
        else:
            callbacks.extend(self.callbacks)

        if 'fake_response' in kwargs and kwargs['fake_response']:
            prompts = self._get_prompt_from_messages(messages, ModelMode.CHAT)
            fake_llm = FakeLLM(
                response=kwargs['fake_response'],
                num_token_func=self.get_num_tokens,
                streaming=self.streaming,
                callbacks=callbacks
            )
            result = fake_llm.generate([prompts])
        else:
            try:
                result = self._run(
                    messages=messages,
                    stop=stop,
                    callbacks=callbacks if not (self.streaming and not self.support_streaming()) else None,
                    **kwargs
                )
            except Exception as ex:
                raise self.handle_exceptions(ex)

        if isinstance(result.generations[0][0], ChatGeneration):
            completion_content = result.generations[0][0].message.content
        else:
            completion_content = result.generations[0][0].text

        if self.streaming and not self.support_streaming():
            # use FakeLLM to simulate streaming when current model not support streaming but streaming is True
            prompts = self._get_prompt_from_messages(messages, ModelMode.CHAT)
            fake_llm = FakeLLM(
                response=completion_content,
                num_token_func=self.get_num_tokens,
                streaming=self.streaming,
                callbacks=callbacks
            )
            fake_llm.generate([prompts])

        if result.llm_output and result.llm_output['token_usage']:
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

    def get_model_kwargs(self):
        return self.model_kwargs

    def set_model_kwargs(self, model_kwargs: ModelKwargs):
        self.model_kwargs = model_kwargs
        self._set_model_kwargs(model_kwargs)

    @abstractmethod
    def _set_model_kwargs(self, model_kwargs: ModelKwargs):
        raise NotImplementedError

    @abstractmethod
    def handle_exceptions(self, ex: Exception) -> Exception:
        """
        Handle llm run exceptions.

        :param ex:
        :return:
        """
        raise NotImplementedError

    def add_callbacks(self, callbacks: Callbacks):
        """
        Add callbacks to client.

        :param callbacks:
        :return:
        """
        if not self.client.callbacks:
            self.client.callbacks = callbacks
        else:
            self.client.callbacks.extend(callbacks)

    @classmethod
    def support_streaming(cls):
        return False

    def _get_prompt_from_messages(self, messages: List[PromptMessage],
                                  model_mode: Optional[ModelMode] = None) -> Union[str | List[BaseMessage]]:
        if not model_mode:
            model_mode = self.model_mode

        if model_mode == ModelMode.COMPLETION:
            if len(messages) == 0:
                return ''

            return messages[0].content
        else:
            if len(messages) == 0:
                return []

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
