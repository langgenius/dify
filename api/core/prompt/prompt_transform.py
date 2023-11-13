import json
import os
import re
import enum
from typing import List, Optional, Tuple

from langchain.memory.chat_memory import BaseChatMemory
from langchain.schema import BaseMessage

from core.model_providers.models.entity.model_params import ModelMode
from core.model_providers.models.entity.message import PromptMessage, MessageType, to_prompt_messages, PromptMessageFile
from core.model_providers.models.llm.base import BaseLLM
from core.model_providers.models.llm.baichuan_model import BaichuanModel
from core.model_providers.models.llm.huggingface_hub_model import HuggingfaceHubModel
from core.model_providers.models.llm.openllm_model import OpenLLMModel
from core.model_providers.models.llm.xinference_model import XinferenceModel
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import PromptTemplateParser
from models.model import AppModelConfig


class AppMode(enum.Enum):
    COMPLETION = 'completion'
    CHAT = 'chat'


class PromptTransform:
    def get_prompt(self,
                   app_mode: str,
                   pre_prompt: str,
                   inputs: dict,
                   query: str,
                   files: List[PromptMessageFile],
                   context: Optional[str],
                   memory: Optional[BaseChatMemory],
                   model_instance: BaseLLM) -> \
            Tuple[List[PromptMessage], Optional[List[str]]]:

        app_mode_enum = AppMode(app_mode)
        model_mode_enum = model_instance.model_mode

        prompt_rules = self._read_prompt_rules_from_file(self._prompt_file_name(app_mode, model_instance))

        if app_mode_enum == AppMode.CHAT and model_mode_enum == ModelMode.CHAT:
            stops = None

            prompt_messages = self._get_simple_chat_app_chat_model_prompt_messages(prompt_rules, pre_prompt, inputs,
                                                                                   query, context, memory,
                                                                                   model_instance, files)
        else:
            stops = prompt_rules.get('stops')
            if stops is not None and len(stops) == 0:
                stops = None

            prompt_messages = self._get_simple_others_prompt_messages(prompt_rules, pre_prompt, inputs, query, context,
                                                                      memory,
                                                                      model_instance, files)
        return prompt_messages, stops

    def get_advanced_prompt(self,
                            app_mode: str,
                            app_model_config: AppModelConfig,
                            inputs: dict,
                            query: str,
                            files: List[PromptMessageFile],
                            context: Optional[str],
                            memory: Optional[BaseChatMemory],
                            model_instance: BaseLLM) -> List[PromptMessage]:

        model_mode = app_model_config.model_dict['mode']

        app_mode_enum = AppMode(app_mode)
        model_mode_enum = ModelMode(model_mode)

        prompt_messages = []

        if app_mode_enum == AppMode.CHAT:
            if model_mode_enum == ModelMode.COMPLETION:
                prompt_messages = self._get_chat_app_completion_model_prompt_messages(app_model_config, inputs, query,
                                                                                      files, context, memory,
                                                                                      model_instance)
            elif model_mode_enum == ModelMode.CHAT:
                prompt_messages = self._get_chat_app_chat_model_prompt_messages(app_model_config, inputs, query, files,
                                                                                context, memory, model_instance)
        elif app_mode_enum == AppMode.COMPLETION:
            if model_mode_enum == ModelMode.CHAT:
                prompt_messages = self._get_completion_app_chat_model_prompt_messages(app_model_config, inputs,
                                                                                      files, context)
            elif model_mode_enum == ModelMode.COMPLETION:
                prompt_messages = self._get_completion_app_completion_model_prompt_messages(app_model_config, inputs,
                                                                                            files, context)

        return prompt_messages

    def _get_history_messages_from_memory(self, memory: BaseChatMemory,
                                          max_token_limit: int) -> str:
        """Get memory messages."""
        memory.max_token_limit = max_token_limit
        memory_key = memory.memory_variables[0]
        external_context = memory.load_memory_variables({})
        return external_context[memory_key]

    def _get_history_messages_list_from_memory(self, memory: BaseChatMemory,
                                               max_token_limit: int) -> List[PromptMessage]:
        """Get memory messages."""
        memory.max_token_limit = max_token_limit
        memory.return_messages = True
        memory_key = memory.memory_variables[0]
        external_context = memory.load_memory_variables({})
        memory.return_messages = False
        return to_prompt_messages(external_context[memory_key])

    def _prompt_file_name(self, mode: str, model_instance: BaseLLM) -> str:
        # baichuan
        if isinstance(model_instance, BaichuanModel):
            return self._prompt_file_name_for_baichuan(mode)

        baichuan_model_hosted_platforms = (HuggingfaceHubModel, OpenLLMModel, XinferenceModel)
        if isinstance(model_instance, baichuan_model_hosted_platforms) and 'baichuan' in model_instance.name.lower():
            return self._prompt_file_name_for_baichuan(mode)

        # common
        if mode == 'completion':
            return 'common_completion'
        else:
            return 'common_chat'

    def _prompt_file_name_for_baichuan(self, mode: str) -> str:
        if mode == 'completion':
            return 'baichuan_completion'
        else:
            return 'baichuan_chat'

    def _read_prompt_rules_from_file(self, prompt_name: str) -> dict:
        # Get the absolute path of the subdirectory
        prompt_path = os.path.join(
            os.path.dirname(os.path.realpath(__file__)),
            'generate_prompts')

        json_file_path = os.path.join(prompt_path, f'{prompt_name}.json')
        # Open the JSON file and read its content
        with open(json_file_path, 'r') as json_file:
            return json.load(json_file)

    def _get_simple_chat_app_chat_model_prompt_messages(self, prompt_rules: dict, pre_prompt: str, inputs: dict,
                                                        query: str,
                                                        context: Optional[str],
                                                        memory: Optional[BaseChatMemory],
                                                        model_instance: BaseLLM,
                                                        files: List[PromptMessageFile]) -> List[PromptMessage]:
        prompt_messages = []

        context_prompt_content = ''
        if context and 'context_prompt' in prompt_rules:
            prompt_template = PromptTemplateParser(template=prompt_rules['context_prompt'])
            context_prompt_content = prompt_template.format(
                {'context': context}
            )

        pre_prompt_content = ''
        if pre_prompt:
            prompt_template = PromptTemplateParser(template=pre_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
            pre_prompt_content = prompt_template.format(
                prompt_inputs
            )

        prompt = ''
        for order in prompt_rules['system_prompt_orders']:
            if order == 'context_prompt':
                prompt += context_prompt_content
            elif order == 'pre_prompt':
                prompt += pre_prompt_content

        prompt = re.sub(r'<\|.*?\|>', '', prompt)

        prompt_messages.append(PromptMessage(type=MessageType.SYSTEM, content=prompt))

        self._append_chat_histories(memory, prompt_messages, model_instance)

        prompt_messages.append(PromptMessage(type=MessageType.USER, content=query, files=files))

        return prompt_messages

    def _get_simple_others_prompt_messages(self, prompt_rules: dict, pre_prompt: str, inputs: dict,
                                           query: str,
                                           context: Optional[str],
                                           memory: Optional[BaseChatMemory],
                                           model_instance: BaseLLM,
                                           files: List[PromptMessageFile]) -> List[PromptMessage]:
        context_prompt_content = ''
        if context and 'context_prompt' in prompt_rules:
            prompt_template = PromptTemplateParser(template=prompt_rules['context_prompt'])
            context_prompt_content = prompt_template.format(
                {'context': context}
            )

        pre_prompt_content = ''
        if pre_prompt:
            prompt_template = PromptTemplateParser(template=pre_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
            pre_prompt_content = prompt_template.format(
                prompt_inputs
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

            rest_tokens = self._calculate_rest_token(tmp_human_message, model_instance)

            memory.human_prefix = prompt_rules['human_prefix'] if 'human_prefix' in prompt_rules else 'Human'
            memory.ai_prefix = prompt_rules['assistant_prefix'] if 'assistant_prefix' in prompt_rules else 'Assistant'

            histories = self._get_history_messages_from_memory(memory, rest_tokens)
            prompt_template = PromptTemplateParser(template=prompt_rules['histories_prompt'])
            histories_prompt_content = prompt_template.format({'histories': histories})

            prompt = ''
            for order in prompt_rules['system_prompt_orders']:
                if order == 'context_prompt':
                    prompt += context_prompt_content
                elif order == 'pre_prompt':
                    prompt += (pre_prompt_content + '\n') if pre_prompt_content else ''
                elif order == 'histories_prompt':
                    prompt += histories_prompt_content

        prompt_template = PromptTemplateParser(template=query_prompt)
        query_prompt_content = prompt_template.format({'query': query})

        prompt += query_prompt_content

        prompt = re.sub(r'<\|.*?\|>', '', prompt)

        return [PromptMessage(content=prompt, files=files)]

    def _set_context_variable(self, context: str, prompt_template: PromptTemplateParser, prompt_inputs: dict) -> None:
        if '#context#' in prompt_template.variable_keys:
            if context:
                prompt_inputs['#context#'] = context
            else:
                prompt_inputs['#context#'] = ''

    def _set_query_variable(self, query: str, prompt_template: PromptTemplateParser, prompt_inputs: dict) -> None:
        if '#query#' in prompt_template.variable_keys:
            if query:
                prompt_inputs['#query#'] = query
            else:
                prompt_inputs['#query#'] = ''

    def _set_histories_variable(self, memory: BaseChatMemory, raw_prompt: str, conversation_histories_role: dict,
                                prompt_template: PromptTemplateParser, prompt_inputs: dict,
                                model_instance: BaseLLM) -> None:
        if '#histories#' in prompt_template.variable_keys:
            if memory:
                tmp_human_message = PromptBuilder.to_human_message(
                    prompt_content=raw_prompt,
                    inputs={'#histories#': '', **prompt_inputs}
                )

                rest_tokens = self._calculate_rest_token(tmp_human_message, model_instance)

                memory.human_prefix = conversation_histories_role['user_prefix']
                memory.ai_prefix = conversation_histories_role['assistant_prefix']
                histories = self._get_history_messages_from_memory(memory, rest_tokens)
                prompt_inputs['#histories#'] = histories
            else:
                prompt_inputs['#histories#'] = ''

    def _append_chat_histories(self, memory: BaseChatMemory, prompt_messages: list[PromptMessage],
                               model_instance: BaseLLM) -> None:
        if memory:
            rest_tokens = self._calculate_rest_token(prompt_messages, model_instance)

            memory.human_prefix = MessageType.USER.value
            memory.ai_prefix = MessageType.ASSISTANT.value
            histories = self._get_history_messages_list_from_memory(memory, rest_tokens)
            prompt_messages.extend(histories)

    def _calculate_rest_token(self, prompt_messages: BaseMessage, model_instance: BaseLLM) -> int:
        rest_tokens = 2000

        if model_instance.model_rules.max_tokens.max:
            curr_message_tokens = model_instance.get_num_tokens(to_prompt_messages(prompt_messages))
            max_tokens = model_instance.model_kwargs.max_tokens
            rest_tokens = model_instance.model_rules.max_tokens.max - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _format_prompt(self, prompt_template: PromptTemplateParser, prompt_inputs: dict) -> str:
        prompt = prompt_template.format(
            prompt_inputs
        )

        prompt = re.sub(r'<\|.*?\|>', '', prompt)
        return prompt

    def _get_chat_app_completion_model_prompt_messages(self,
                                                       app_model_config: AppModelConfig,
                                                       inputs: dict,
                                                       query: str,
                                                       files: List[PromptMessageFile],
                                                       context: Optional[str],
                                                       memory: Optional[BaseChatMemory],
                                                       model_instance: BaseLLM) -> List[PromptMessage]:

        raw_prompt = app_model_config.completion_prompt_config_dict['prompt']['text']
        conversation_histories_role = app_model_config.completion_prompt_config_dict['conversation_histories_role']

        prompt_messages = []

        prompt_template = PromptTemplateParser(template=raw_prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        self._set_context_variable(context, prompt_template, prompt_inputs)

        self._set_query_variable(query, prompt_template, prompt_inputs)

        self._set_histories_variable(memory, raw_prompt, conversation_histories_role, prompt_template, prompt_inputs,
                                     model_instance)

        prompt = self._format_prompt(prompt_template, prompt_inputs)

        prompt_messages.append(PromptMessage(type=MessageType.USER, content=prompt, files=files))

        return prompt_messages

    def _get_chat_app_chat_model_prompt_messages(self,
                                                 app_model_config: AppModelConfig,
                                                 inputs: dict,
                                                 query: str,
                                                 files: List[PromptMessageFile],
                                                 context: Optional[str],
                                                 memory: Optional[BaseChatMemory],
                                                 model_instance: BaseLLM) -> List[PromptMessage]:
        raw_prompt_list = app_model_config.chat_prompt_config_dict['prompt']

        prompt_messages = []

        for prompt_item in raw_prompt_list:
            raw_prompt = prompt_item['text']

            prompt_template = PromptTemplateParser(template=raw_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

            self._set_context_variable(context, prompt_template, prompt_inputs)

            prompt = self._format_prompt(prompt_template, prompt_inputs)

            prompt_messages.append(PromptMessage(type=MessageType(prompt_item['role']), content=prompt))

        self._append_chat_histories(memory, prompt_messages, model_instance)

        prompt_messages.append(PromptMessage(type=MessageType.USER, content=query, files=files))

        return prompt_messages

    def _get_completion_app_completion_model_prompt_messages(self,
                                                             app_model_config: AppModelConfig,
                                                             inputs: dict,
                                                             files: List[PromptMessageFile],
                                                             context: Optional[str]) -> List[PromptMessage]:
        raw_prompt = app_model_config.completion_prompt_config_dict['prompt']['text']

        prompt_messages = []

        prompt_template = PromptTemplateParser(template=raw_prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        self._set_context_variable(context, prompt_template, prompt_inputs)

        prompt = self._format_prompt(prompt_template, prompt_inputs)

        prompt_messages.append(PromptMessage(type=MessageType(MessageType.USER), content=prompt, files=files))

        return prompt_messages

    def _get_completion_app_chat_model_prompt_messages(self,
                                                       app_model_config: AppModelConfig,
                                                       inputs: dict,
                                                       files: List[PromptMessageFile],
                                                       context: Optional[str]) -> List[PromptMessage]:
        raw_prompt_list = app_model_config.chat_prompt_config_dict['prompt']

        prompt_messages = []

        for prompt_item in raw_prompt_list:
            raw_prompt = prompt_item['text']

            prompt_template = PromptTemplateParser(template=raw_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

            self._set_context_variable(context, prompt_template, prompt_inputs)

            prompt = self._format_prompt(prompt_template, prompt_inputs)

            prompt_messages.append(PromptMessage(type=MessageType(prompt_item['role']), content=prompt))

        for prompt_message in prompt_messages[::-1]:
            if prompt_message.type == MessageType.USER:
                prompt_message.files = files
                break

        return prompt_messages
