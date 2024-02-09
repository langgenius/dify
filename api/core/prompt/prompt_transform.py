import enum
import json
import os
import re
from typing import Optional, cast

from core.entities.application_entities import (
    AdvancedCompletionPromptTemplateEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.file.file_obj import FileObj
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import PromptTemplateParser


class AppMode(enum.Enum):
    COMPLETION = 'completion'
    CHAT = 'chat'

    @classmethod
    def value_of(cls, value: str) -> 'AppMode':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')


class ModelMode(enum.Enum):
    COMPLETION = 'completion'
    CHAT = 'chat'

    @classmethod
    def value_of(cls, value: str) -> 'ModelMode':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')


class PromptTransform:
    def get_prompt(self,
                   app_mode: str,
                   prompt_template_entity: PromptTemplateEntity,
                   inputs: dict,
                   query: str,
                   files: list[FileObj],
                   context: Optional[str],
                   memory: Optional[TokenBufferMemory],
                   model_config: ModelConfigEntity) -> \
            tuple[list[PromptMessage], Optional[list[str]]]:
        app_mode = AppMode.value_of(app_mode)
        model_mode = ModelMode.value_of(model_config.mode)

        prompt_rules = self._read_prompt_rules_from_file(self._prompt_file_name(
            app_mode=app_mode,
            provider=model_config.provider,
            model=model_config.model
        ))

        if app_mode == AppMode.CHAT and model_mode == ModelMode.CHAT:
            stops = None

            prompt_messages = self._get_simple_chat_app_chat_model_prompt_messages(
                prompt_rules=prompt_rules,
                pre_prompt=prompt_template_entity.simple_prompt_template,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )
        else:
            stops = prompt_rules.get('stops')
            if stops is not None and len(stops) == 0:
                stops = None

            prompt_messages = self._get_simple_others_prompt_messages(
                prompt_rules=prompt_rules,
                pre_prompt=prompt_template_entity.simple_prompt_template,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )
        return prompt_messages, stops

    def get_advanced_prompt(self, app_mode: str,
                            prompt_template_entity: PromptTemplateEntity,
                            inputs: dict,
                            query: str,
                            files: list[FileObj],
                            context: Optional[str],
                            memory: Optional[TokenBufferMemory],
                            model_config: ModelConfigEntity) -> list[PromptMessage]:
        app_mode = AppMode.value_of(app_mode)
        model_mode = ModelMode.value_of(model_config.mode)

        prompt_messages = []

        if app_mode == AppMode.CHAT:
            if model_mode == ModelMode.COMPLETION:
                prompt_messages = self._get_chat_app_completion_model_prompt_messages(
                    prompt_template_entity=prompt_template_entity,
                    inputs=inputs,
                    query=query,
                    files=files,
                    context=context,
                    memory=memory,
                    model_config=model_config
                )
            elif model_mode == ModelMode.CHAT:
                prompt_messages = self._get_chat_app_chat_model_prompt_messages(
                    prompt_template_entity=prompt_template_entity,
                    inputs=inputs,
                    query=query,
                    files=files,
                    context=context,
                    memory=memory,
                    model_config=model_config
                )
        elif app_mode == AppMode.COMPLETION:
            if model_mode == ModelMode.CHAT:
                prompt_messages = self._get_completion_app_chat_model_prompt_messages(
                    prompt_template_entity=prompt_template_entity,
                    inputs=inputs,
                    files=files,
                    context=context,
                )
            elif model_mode == ModelMode.COMPLETION:
                prompt_messages = self._get_completion_app_completion_model_prompt_messages(
                    prompt_template_entity=prompt_template_entity,
                    inputs=inputs,
                    context=context,
                )

        return prompt_messages

    def _get_history_messages_from_memory(self, memory: TokenBufferMemory,
                                          max_token_limit: int,
                                          human_prefix: Optional[str] = None,
                                          ai_prefix: Optional[str] = None) -> str:
        """Get memory messages."""
        kwargs = {
            "max_token_limit": max_token_limit
        }

        if human_prefix:
            kwargs['human_prefix'] = human_prefix

        if ai_prefix:
            kwargs['ai_prefix'] = ai_prefix

        return memory.get_history_prompt_text(
            **kwargs
        )

    def _get_history_messages_list_from_memory(self, memory: TokenBufferMemory,
                                               max_token_limit: int) -> list[PromptMessage]:
        """Get memory messages."""
        return memory.get_history_prompt_messages(
            max_token_limit=max_token_limit
        )

    def _prompt_file_name(self, app_mode: AppMode, provider: str, model: str) -> str:
        # baichuan
        if provider == 'baichuan':
            return self._prompt_file_name_for_baichuan(app_mode)

        baichuan_supported_providers = ["huggingface_hub", "openllm", "xinference"]
        if provider in baichuan_supported_providers and 'baichuan' in model.lower():
            return self._prompt_file_name_for_baichuan(app_mode)

        # common
        if app_mode == AppMode.COMPLETION:
            return 'common_completion'
        else:
            return 'common_chat'

    def _prompt_file_name_for_baichuan(self, app_mode: AppMode) -> str:
        if app_mode == AppMode.COMPLETION:
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
        with open(json_file_path, encoding='utf-8') as json_file:
            return json.load(json_file)

    def _get_simple_chat_app_chat_model_prompt_messages(self, prompt_rules: dict,
                                                        pre_prompt: str,
                                                        inputs: dict,
                                                        query: str,
                                                        context: Optional[str],
                                                        files: list[FileObj],
                                                        memory: Optional[TokenBufferMemory],
                                                        model_config: ModelConfigEntity) -> list[PromptMessage]:
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

        if prompt:
            prompt_messages.append(SystemPromptMessage(content=prompt))

        self._append_chat_histories(
            memory=memory,
            prompt_messages=prompt_messages,
            model_config=model_config
        )

        if files:
            prompt_message_contents = [TextPromptMessageContent(data=query)]
            for file in files:
                prompt_message_contents.append(file.prompt_message_content)

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages

    def _get_simple_others_prompt_messages(self, prompt_rules: dict,
                                           pre_prompt: str,
                                           inputs: dict,
                                           query: str,
                                           context: Optional[str],
                                           memory: Optional[TokenBufferMemory],
                                           files: list[FileObj],
                                           model_config: ModelConfigEntity) -> list[PromptMessage]:
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
            tmp_human_message = UserPromptMessage(
                content=PromptBuilder.parse_prompt(
                    prompt=prompt + query_prompt,
                    inputs={
                        'query': query
                    }
                )
            )

            rest_tokens = self._calculate_rest_token([tmp_human_message], model_config)

            histories = self._get_history_messages_from_memory(
                memory=memory,
                max_token_limit=rest_tokens,
                ai_prefix=prompt_rules['human_prefix'] if 'human_prefix' in prompt_rules else 'Human',
                human_prefix=prompt_rules['assistant_prefix'] if 'assistant_prefix' in prompt_rules else 'Assistant'
            )
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

        model_mode = ModelMode.value_of(model_config.mode)

        if model_mode == ModelMode.CHAT and files:
            prompt_message_contents = [TextPromptMessageContent(data=prompt)]
            for file in files:
                prompt_message_contents.append(file.prompt_message_content)

            prompt_message = UserPromptMessage(content=prompt_message_contents)
        else:
            if files:
                prompt_message_contents = [TextPromptMessageContent(data=prompt)]
                for file in files:
                    prompt_message_contents.append(file.prompt_message_content)

                prompt_message = UserPromptMessage(content=prompt_message_contents)
            else:
                prompt_message = UserPromptMessage(content=prompt)

        return [prompt_message]

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

    def _set_histories_variable(self, memory: TokenBufferMemory,
                                raw_prompt: str,
                                role_prefix: AdvancedCompletionPromptTemplateEntity.RolePrefixEntity,
                                prompt_template: PromptTemplateParser,
                                prompt_inputs: dict,
                                model_config: ModelConfigEntity) -> None:
        if '#histories#' in prompt_template.variable_keys:
            if memory:
                tmp_human_message = UserPromptMessage(
                    content=PromptBuilder.parse_prompt(
                        prompt=raw_prompt,
                        inputs={'#histories#': '', **prompt_inputs}
                    )
                )

                rest_tokens = self._calculate_rest_token([tmp_human_message], model_config)

                histories = self._get_history_messages_from_memory(
                    memory=memory,
                    max_token_limit=rest_tokens,
                    human_prefix=role_prefix.user,
                    ai_prefix=role_prefix.assistant
                )
                prompt_inputs['#histories#'] = histories
            else:
                prompt_inputs['#histories#'] = ''

    def _append_chat_histories(self, memory: TokenBufferMemory,
                               prompt_messages: list[PromptMessage],
                               model_config: ModelConfigEntity) -> None:
        if memory:
            rest_tokens = self._calculate_rest_token(prompt_messages, model_config)
            histories = self._get_history_messages_list_from_memory(memory, rest_tokens)
            prompt_messages.extend(histories)

    def _calculate_rest_token(self, prompt_messages: list[PromptMessage], model_config: ModelConfigEntity) -> int:
        rest_tokens = 2000

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)
        if model_context_tokens:
            model_type_instance = model_config.provider_model_bundle.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)

            curr_message_tokens = model_type_instance.get_num_tokens(
                model_config.model,
                model_config.credentials,
                prompt_messages
            )

            max_tokens = 0
            for parameter_rule in model_config.model_schema.parameter_rules:
                if (parameter_rule.name == 'max_tokens'
                        or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                    max_tokens = (model_config.parameters.get(parameter_rule.name)
                                  or model_config.parameters.get(parameter_rule.use_template)) or 0

            rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _format_prompt(self, prompt_template: PromptTemplateParser, prompt_inputs: dict) -> str:
        prompt = prompt_template.format(
            prompt_inputs
        )

        prompt = re.sub(r'<\|.*?\|>', '', prompt)
        return prompt

    def _get_chat_app_completion_model_prompt_messages(self,
                                                       prompt_template_entity: PromptTemplateEntity,
                                                       inputs: dict,
                                                       query: str,
                                                       files: list[FileObj],
                                                       context: Optional[str],
                                                       memory: Optional[TokenBufferMemory],
                                                       model_config: ModelConfigEntity) -> list[PromptMessage]:

        raw_prompt = prompt_template_entity.advanced_completion_prompt_template.prompt
        role_prefix = prompt_template_entity.advanced_completion_prompt_template.role_prefix

        prompt_messages = []

        prompt_template = PromptTemplateParser(template=raw_prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        self._set_context_variable(context, prompt_template, prompt_inputs)

        self._set_query_variable(query, prompt_template, prompt_inputs)

        self._set_histories_variable(
            memory=memory,
            raw_prompt=raw_prompt,
            role_prefix=role_prefix,
            prompt_template=prompt_template,
            prompt_inputs=prompt_inputs,
            model_config=model_config
        )

        prompt = self._format_prompt(prompt_template, prompt_inputs)

        if files:
            prompt_message_contents = [TextPromptMessageContent(data=prompt)]
            for file in files:
                prompt_message_contents.append(file.prompt_message_content)

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=prompt))

        return prompt_messages

    def _get_chat_app_chat_model_prompt_messages(self,
                                                 prompt_template_entity: PromptTemplateEntity,
                                                 inputs: dict,
                                                 query: str,
                                                 files: list[FileObj],
                                                 context: Optional[str],
                                                 memory: Optional[TokenBufferMemory],
                                                 model_config: ModelConfigEntity) -> list[PromptMessage]:
        raw_prompt_list = prompt_template_entity.advanced_chat_prompt_template.messages

        prompt_messages = []

        for prompt_item in raw_prompt_list:
            raw_prompt = prompt_item.text

            prompt_template = PromptTemplateParser(template=raw_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

            self._set_context_variable(context, prompt_template, prompt_inputs)

            prompt = self._format_prompt(prompt_template, prompt_inputs)

            if prompt_item.role == PromptMessageRole.USER:
                prompt_messages.append(UserPromptMessage(content=prompt))
            elif prompt_item.role == PromptMessageRole.SYSTEM and prompt:
                prompt_messages.append(SystemPromptMessage(content=prompt))
            elif prompt_item.role == PromptMessageRole.ASSISTANT:
                prompt_messages.append(AssistantPromptMessage(content=prompt))

        self._append_chat_histories(memory, prompt_messages, model_config)

        if files:
            prompt_message_contents = [TextPromptMessageContent(data=query)]
            for file in files:
                prompt_message_contents.append(file.prompt_message_content)

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages

    def _get_completion_app_completion_model_prompt_messages(self,
                                                             prompt_template_entity: PromptTemplateEntity,
                                                             inputs: dict,
                                                             context: Optional[str]) -> list[PromptMessage]:
        raw_prompt = prompt_template_entity.advanced_completion_prompt_template.prompt

        prompt_messages = []

        prompt_template = PromptTemplateParser(template=raw_prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        self._set_context_variable(context, prompt_template, prompt_inputs)

        prompt = self._format_prompt(prompt_template, prompt_inputs)

        prompt_messages.append(UserPromptMessage(content=prompt))

        return prompt_messages

    def _get_completion_app_chat_model_prompt_messages(self,
                                                       prompt_template_entity: PromptTemplateEntity,
                                                       inputs: dict,
                                                       files: list[FileObj],
                                                       context: Optional[str]) -> list[PromptMessage]:
        raw_prompt_list = prompt_template_entity.advanced_chat_prompt_template.messages

        prompt_messages = []

        for prompt_item in raw_prompt_list:
            raw_prompt = prompt_item.text

            prompt_template = PromptTemplateParser(template=raw_prompt)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

            self._set_context_variable(context, prompt_template, prompt_inputs)

            prompt = self._format_prompt(prompt_template, prompt_inputs)

            if prompt_item.role == PromptMessageRole.USER:
                prompt_messages.append(UserPromptMessage(content=prompt))
            elif prompt_item.role == PromptMessageRole.SYSTEM and prompt:
                prompt_messages.append(SystemPromptMessage(content=prompt))
            elif prompt_item.role == PromptMessageRole.ASSISTANT:
                prompt_messages.append(AssistantPromptMessage(content=prompt))

        for prompt_message in prompt_messages[::-1]:
            if prompt_message.role == PromptMessageRole.USER:
                if files:
                    prompt_message_contents = [TextPromptMessageContent(data=prompt_message.content)]
                    for file in files:
                        prompt_message_contents.append(file.prompt_message_content)

                    prompt_message.content = prompt_message_contents
                break

        return prompt_messages
