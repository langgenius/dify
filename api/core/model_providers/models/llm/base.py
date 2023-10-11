import json
import os
import re
import time
from abc import abstractmethod
from typing import List, Optional, Any, Union, Tuple
import decimal

from langchain.callbacks.manager import Callbacks
from langchain.memory.chat_memory import BaseChatMemory
from langchain.schema import LLMResult, SystemMessage, AIMessage, HumanMessage, BaseMessage, ChatGeneration

from core.callback_handler.std_out_callback_handler import DifyStreamingStdOutCallbackHandler, DifyStdOutCallbackHandler
from core.helper import moderation
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.message import PromptMessage, MessageType, LLMRunResult, to_prompt_messages, \
    to_lc_messages
from core.model_providers.models.entity.model_params import ModelType, ModelKwargs, ModelMode, ModelKwargsRules
from core.model_providers.providers.base import BaseModelProvider
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import JinjaPromptTemplate
from core.third_party.langchain.llms.fake import FakeLLM
import logging

from extensions.ext_database import db

logger = logging.getLogger(__name__)


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

    @property
    def base_model_name(self) -> str:
        """
        get llm base model name

        :return: str
        """
        return self.name

    @property
    def price_config(self) -> dict:
        def get_or_default():
            default_price_config = {
                'prompt': decimal.Decimal('0'),
                'completion': decimal.Decimal('0'),
                'unit': decimal.Decimal('0'),
                'currency': 'USD'
            }
            rules = self.model_provider.get_rules()
            price_config = rules['price_config'][
                self.base_model_name] if 'price_config' in rules else default_price_config
            price_config = {
                'prompt': decimal.Decimal(price_config['prompt']),
                'completion': decimal.Decimal(price_config['completion']),
                'unit': decimal.Decimal(price_config['unit']),
                'currency': price_config['currency']
            }
            return price_config

        self._price_config = self._price_config if hasattr(self, '_price_config') else get_or_default()

        logger.debug(f"model: {self.name} price_config: {self._price_config}")
        return self._price_config

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
        moderation_result = moderation.check_moderation(
            self.model_provider,
            "\n".join([message.content for message in messages])
        )

        if not moderation_result:
            kwargs['fake_response'] = "I apologize for any confusion, " \
                                      "but I'm an AI assistant to be helpful, harmless, and honest."

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
                    callbacks=callbacks if not (self.streaming and not self.support_streaming) else None,
                    **kwargs
                )
            except Exception as ex:
                raise self.handle_exceptions(ex)

        function_call = None
        if isinstance(result.generations[0][0], ChatGeneration):
            completion_content = result.generations[0][0].message.content
            if 'function_call' in result.generations[0][0].message.additional_kwargs:
                function_call = result.generations[0][0].message.additional_kwargs.get('function_call')
        else:
            completion_content = result.generations[0][0].text

        if self.streaming and not self.support_streaming:
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
            completion_tokens = self.get_num_tokens(
                [PromptMessage(content=completion_content, type=MessageType.ASSISTANT)])
            total_tokens = prompt_tokens + completion_tokens

        self.model_provider.update_last_used()

        if self.deduct_quota:
            self.model_provider.deduct_quota(total_tokens)

        return LLMRunResult(
            content=completion_content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            function_call=function_call
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

    def calc_tokens_price(self, tokens: int, message_type: MessageType) -> decimal.Decimal:
        """
        calc tokens total price.

        :param tokens:
        :param message_type:
        :return:
        """
        if message_type == MessageType.HUMAN or message_type == MessageType.SYSTEM:
            unit_price = self.price_config['prompt']
        else:
            unit_price = self.price_config['completion']
        unit = self.get_price_unit(message_type)

        total_price = tokens * unit_price * unit
        total_price = total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)
        logging.debug(f"tokens={tokens}, unit_price={unit_price}, unit={unit}, total_price:{total_price}")
        return total_price

    def get_tokens_unit_price(self, message_type: MessageType) -> decimal.Decimal:
        """
        get token price.

        :param message_type:
        :return: decimal.Decimal('0.0001')
        """
        if message_type == MessageType.HUMAN or message_type == MessageType.SYSTEM:
            unit_price = self.price_config['prompt']
        else:
            unit_price = self.price_config['completion']
        unit_price = unit_price.quantize(decimal.Decimal('0.0001'), rounding=decimal.ROUND_HALF_UP)
        logging.debug(f"unit_price={unit_price}")
        return unit_price

    def get_price_unit(self, message_type: MessageType) -> decimal.Decimal:
        """
        get price unit.

        :param message_type:
        :return: decimal.Decimal('0.000001')
        """
        if message_type == MessageType.HUMAN or message_type == MessageType.SYSTEM:
            price_unit = self.price_config['unit']
        else:
            price_unit = self.price_config['unit']

        price_unit = price_unit.quantize(decimal.Decimal('0.000001'), rounding=decimal.ROUND_HALF_UP)
        logging.debug(f"price_unit={price_unit}")
        return price_unit

    def get_currency(self) -> str:
        """
        get token currency.

        :return: get from price config, default 'USD'
        """
        currency = self.price_config['currency']
        return currency

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

    @property
    def support_streaming(self):
        return False

    def get_prompt(self, mode: str,
                   pre_prompt: str, inputs: dict,
                   query: str,
                   context: Optional[str],
                   memory: Optional[BaseChatMemory]) -> \
            Tuple[List[PromptMessage], Optional[List[str]]]:
        prompt_rules = self._read_prompt_rules_from_file(self.prompt_file_name(mode))
        prompt, stops = self._get_prompt_and_stop(prompt_rules, pre_prompt, inputs, query, context, memory)
        return [PromptMessage(content=prompt)], stops

    def prompt_file_name(self, mode: str) -> str:
        if mode == 'completion':
            return 'common_completion'
        else:
            return 'common_chat'

    def _get_prompt_and_stop(self, prompt_rules: dict, pre_prompt: str, inputs: dict,
                             query: str,
                             context: Optional[str],
                             memory: Optional[BaseChatMemory]) -> Tuple[str, Optional[list]]:
        context_prompt_content = ''
        if context and 'context_prompt' in prompt_rules:
            prompt_template = JinjaPromptTemplate.from_template(template=prompt_rules['context_prompt'])
            context_prompt_content = prompt_template.format(
                context=context
            )

        pre_prompt_content = ''
        if pre_prompt:
            prompt_template = JinjaPromptTemplate.from_template(template=pre_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.input_variables if k in inputs}
            pre_prompt_content = prompt_template.format(
                **prompt_inputs
            )

        prompt = ''
        for order in prompt_rules['system_prompt_orders']:
            if order == 'context_prompt':
                prompt += context_prompt_content
            elif order == 'pre_prompt':
                prompt += pre_prompt_content

        query_prompt = prompt_rules['query_prompt'] if 'query_prompt' in prompt_rules else '{{query}}'

        if memory and 'histories_prompt' in prompt_rules:
            # append chat histories
            tmp_human_message = PromptBuilder.to_human_message(
                prompt_content=prompt + query_prompt,
                inputs={
                    'query': query
                }
            )

            if self.model_rules.max_tokens.max:
                curr_message_tokens = self.get_num_tokens(to_prompt_messages([tmp_human_message]))
                max_tokens = self.model_kwargs.max_tokens
                rest_tokens = self.model_rules.max_tokens.max - max_tokens - curr_message_tokens
                rest_tokens = max(rest_tokens, 0)
            else:
                rest_tokens = 2000

            memory.human_prefix = prompt_rules['human_prefix'] if 'human_prefix' in prompt_rules else 'Human'
            memory.ai_prefix = prompt_rules['assistant_prefix'] if 'assistant_prefix' in prompt_rules else 'Assistant'

            histories = self._get_history_messages_from_memory(memory, rest_tokens)
            prompt_template = JinjaPromptTemplate.from_template(template=prompt_rules['histories_prompt'])
            histories_prompt_content = prompt_template.format(
                histories=histories
            )

            prompt = ''
            for order in prompt_rules['system_prompt_orders']:
                if order == 'context_prompt':
                    prompt += context_prompt_content
                elif order == 'pre_prompt':
                    prompt += (pre_prompt_content + '\n') if pre_prompt_content else ''
                elif order == 'histories_prompt':
                    prompt += histories_prompt_content

        prompt_template = JinjaPromptTemplate.from_template(template=query_prompt)
        query_prompt_content = prompt_template.format(
            query=query
        )

        prompt += query_prompt_content

        prompt = re.sub(r'<\|.*?\|>', '', prompt)

        stops = prompt_rules.get('stops')
        if stops is not None and len(stops) == 0:
            stops = None

        return prompt, stops

    def _read_prompt_rules_from_file(self, prompt_name: str) -> dict:
        # Get the absolute path of the subdirectory
        prompt_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))),
            'prompt/generate_prompts')

        json_file_path = os.path.join(prompt_path, f'{prompt_name}.json')
        # Open the JSON file and read its content
        with open(json_file_path, 'r') as json_file:
            return json.load(json_file)

    def _get_history_messages_from_memory(self, memory: BaseChatMemory,
                                          max_token_limit: int) -> str:
        """Get memory messages."""
        memory.max_token_limit = max_token_limit
        memory_key = memory.memory_variables[0]
        external_context = memory.load_memory_variables({})
        return external_context[memory_key]

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

            return to_lc_messages(messages)

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
