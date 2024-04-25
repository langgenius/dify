import enum
import json
import os
from typing import Optional

from core.app.app_config.entities import PromptTemplateEntity
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.file.file_obj import FileVar
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import (
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.prompt.prompt_transform import PromptTransform
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from models.model import AppMode


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


prompt_file_contents = {}


class SimplePromptTransform(PromptTransform):
    """
    Simple Prompt Transform for Chatbot App Basic Mode.
    """

    def get_prompt(self,
                   app_mode: AppMode,
                   prompt_template_entity: PromptTemplateEntity,
                   inputs: dict,
                   query: str,
                   files: list[FileVar],
                   context: Optional[str],
                   memory: Optional[TokenBufferMemory],
                   model_config: ModelConfigWithCredentialsEntity) -> \
            tuple[list[PromptMessage], Optional[list[str]]]:
        inputs = {key: str(value) for key, value in inputs.items()}

        model_mode = ModelMode.value_of(model_config.mode)
        if model_mode == ModelMode.CHAT:
            prompt_messages, stops = self._get_chat_model_prompt_messages(
                app_mode=app_mode,
                pre_prompt=prompt_template_entity.simple_prompt_template,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )
        else:
            prompt_messages, stops = self._get_completion_model_prompt_messages(
                app_mode=app_mode,
                pre_prompt=prompt_template_entity.simple_prompt_template,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )

        return prompt_messages, stops

    def get_prompt_str_and_rules(self, app_mode: AppMode,
                                 model_config: ModelConfigWithCredentialsEntity,
                                 pre_prompt: str,
                                 inputs: dict,
                                 query: Optional[str] = None,
                                 context: Optional[str] = None,
                                 histories: Optional[str] = None,
                                 ) -> tuple[str, dict]:
        # get prompt template
        prompt_template_config = self.get_prompt_template(
            app_mode=app_mode,
            provider=model_config.provider,
            model=model_config.model,
            pre_prompt=pre_prompt,
            has_context=context is not None,
            query_in_prompt=query is not None,
            with_memory_prompt=histories is not None
        )

        variables = {k: inputs[k] for k in prompt_template_config['custom_variable_keys'] if k in inputs}

        for v in prompt_template_config['special_variable_keys']:
            # support #context#, #query# and #histories#
            if v == '#context#':
                variables['#context#'] = context if context else ''
            elif v == '#query#':
                variables['#query#'] = query if query else ''
            elif v == '#histories#':
                variables['#histories#'] = histories if histories else ''

        prompt_template = prompt_template_config['prompt_template']
        prompt = prompt_template.format(variables)

        return prompt, prompt_template_config['prompt_rules']

    def get_prompt_template(self, app_mode: AppMode,
                            provider: str,
                            model: str,
                            pre_prompt: str,
                            has_context: bool,
                            query_in_prompt: bool,
                            with_memory_prompt: bool = False) -> dict:
        prompt_rules = self._get_prompt_rule(
            app_mode=app_mode,
            provider=provider,
            model=model
        )

        custom_variable_keys = []
        special_variable_keys = []

        prompt = ''
        for order in prompt_rules['system_prompt_orders']:
            if order == 'context_prompt' and has_context:
                prompt += prompt_rules['context_prompt']
                special_variable_keys.append('#context#')
            elif order == 'pre_prompt' and pre_prompt:
                prompt += pre_prompt + '\n'
                pre_prompt_template = PromptTemplateParser(template=pre_prompt)
                custom_variable_keys = pre_prompt_template.variable_keys
            elif order == 'histories_prompt' and with_memory_prompt:
                prompt += prompt_rules['histories_prompt']
                special_variable_keys.append('#histories#')

        if query_in_prompt:
            prompt += prompt_rules['query_prompt'] if 'query_prompt' in prompt_rules else '{{#query#}}'
            special_variable_keys.append('#query#')

        return {
            "prompt_template": PromptTemplateParser(template=prompt),
            "custom_variable_keys": custom_variable_keys,
            "special_variable_keys": special_variable_keys,
            "prompt_rules": prompt_rules
        }

    def _get_chat_model_prompt_messages(self, app_mode: AppMode,
                                        pre_prompt: str,
                                        inputs: dict,
                                        query: str,
                                        context: Optional[str],
                                        files: list[FileVar],
                                        memory: Optional[TokenBufferMemory],
                                        model_config: ModelConfigWithCredentialsEntity) \
            -> tuple[list[PromptMessage], Optional[list[str]]]:
        prompt_messages = []

        # get prompt
        prompt, _ = self.get_prompt_str_and_rules(
            app_mode=app_mode,
            model_config=model_config,
            pre_prompt=pre_prompt,
            inputs=inputs,
            query=None,
            context=context
        )

        if prompt and query:
            prompt_messages.append(SystemPromptMessage(content=prompt))

        if memory:
            prompt_messages = self._append_chat_histories(
                memory=memory,
                memory_config=MemoryConfig(
                    window=MemoryConfig.WindowConfig(
                        enabled=False,
                    )
                ),
                prompt_messages=prompt_messages,
                model_config=model_config
            )

        if query:
            prompt_messages.append(self.get_last_user_message(query, files))
        else:
            prompt_messages.append(self.get_last_user_message(prompt, files))

        return prompt_messages, None

    def _get_completion_model_prompt_messages(self, app_mode: AppMode,
                                              pre_prompt: str,
                                              inputs: dict,
                                              query: str,
                                              context: Optional[str],
                                              files: list[FileVar],
                                              memory: Optional[TokenBufferMemory],
                                              model_config: ModelConfigWithCredentialsEntity) \
            -> tuple[list[PromptMessage], Optional[list[str]]]:
        # get prompt
        prompt, prompt_rules = self.get_prompt_str_and_rules(
            app_mode=app_mode,
            model_config=model_config,
            pre_prompt=pre_prompt,
            inputs=inputs,
            query=query,
            context=context
        )

        if memory:
            tmp_human_message = UserPromptMessage(
                content=prompt
            )

            rest_tokens = self._calculate_rest_token([tmp_human_message], model_config)
            histories = self._get_history_messages_from_memory(
                memory=memory,
                memory_config=MemoryConfig(
                    window=MemoryConfig.WindowConfig(
                        enabled=False,
                    )
                ),
                max_token_limit=rest_tokens,
                human_prefix=prompt_rules['human_prefix'] if 'human_prefix' in prompt_rules else 'Human',
                ai_prefix=prompt_rules['assistant_prefix'] if 'assistant_prefix' in prompt_rules else 'Assistant'
            )

            # get prompt
            prompt, prompt_rules = self.get_prompt_str_and_rules(
                app_mode=app_mode,
                model_config=model_config,
                pre_prompt=pre_prompt,
                inputs=inputs,
                query=query,
                context=context,
                histories=histories
            )

        stops = prompt_rules.get('stops')
        if stops is not None and len(stops) == 0:
            stops = None

        return [self.get_last_user_message(prompt, files)], stops

    def get_last_user_message(self, prompt: str, files: list[FileVar]) -> UserPromptMessage:
        if files:
            prompt_message_contents = [TextPromptMessageContent(data=prompt)]
            for file in files:
                prompt_message_contents.append(file.prompt_message_content)

            prompt_message = UserPromptMessage(content=prompt_message_contents)
        else:
            prompt_message = UserPromptMessage(content=prompt)

        return prompt_message

    def _get_prompt_rule(self, app_mode: AppMode, provider: str, model: str) -> dict:
        """
        Get simple prompt rule.
        :param app_mode: app mode
        :param provider: model provider
        :param model: model name
        :return:
        """
        prompt_file_name = self._prompt_file_name(
            app_mode=app_mode,
            provider=provider,
            model=model
        )

        # Check if the prompt file is already loaded
        if prompt_file_name in prompt_file_contents:
            return prompt_file_contents[prompt_file_name]

        # Get the absolute path of the subdirectory
        prompt_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'prompt_templates')
        json_file_path = os.path.join(prompt_path, f'{prompt_file_name}.json')

        # Open the JSON file and read its content
        with open(json_file_path, encoding='utf-8') as json_file:
            content = json.load(json_file)

            # Store the content of the prompt file
            prompt_file_contents[prompt_file_name] = content

            return content

    def _prompt_file_name(self, app_mode: AppMode, provider: str, model: str) -> str:
        # baichuan
        is_baichuan = False
        if provider == 'baichuan':
            is_baichuan = True
        else:
            baichuan_supported_providers = ["huggingface_hub", "openllm", "xinference"]
            if provider in baichuan_supported_providers and 'baichuan' in model.lower():
                is_baichuan = True

        if is_baichuan:
            if app_mode == AppMode.COMPLETION:
                return 'baichuan_completion'
            else:
                return 'baichuan_chat'

        # common
        if app_mode == AppMode.COMPLETION:
            return 'common_completion'
        else:
            return 'common_chat'
