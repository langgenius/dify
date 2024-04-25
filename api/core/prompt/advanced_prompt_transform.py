from typing import Optional, Union

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.file.file_obj import FileVar
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.prompt.prompt_transform import PromptTransform
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_template_parser import PromptTemplateParser


class AdvancedPromptTransform(PromptTransform):
    """
    Advanced Prompt Transform for Workflow LLM Node.
    """
    def __init__(self, with_variable_tmpl: bool = False) -> None:
        self.with_variable_tmpl = with_variable_tmpl

    def get_prompt(self, prompt_template: Union[list[ChatModelMessage], CompletionModelPromptTemplate],
                   inputs: dict,
                   query: str,
                   files: list[FileVar],
                   context: Optional[str],
                   memory_config: Optional[MemoryConfig],
                   memory: Optional[TokenBufferMemory],
                   model_config: ModelConfigWithCredentialsEntity) -> list[PromptMessage]:
        inputs = {key: str(value) for key, value in inputs.items()}

        prompt_messages = []

        model_mode = ModelMode.value_of(model_config.mode)
        if model_mode == ModelMode.COMPLETION:
            prompt_messages = self._get_completion_model_prompt_messages(
                prompt_template=prompt_template,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory_config=memory_config,
                memory=memory,
                model_config=model_config
            )
        elif model_mode == ModelMode.CHAT:
            prompt_messages = self._get_chat_model_prompt_messages(
                prompt_template=prompt_template,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory_config=memory_config,
                memory=memory,
                model_config=model_config
            )

        return prompt_messages

    def _get_completion_model_prompt_messages(self,
                                              prompt_template: CompletionModelPromptTemplate,
                                              inputs: dict,
                                              query: Optional[str],
                                              files: list[FileVar],
                                              context: Optional[str],
                                              memory_config: Optional[MemoryConfig],
                                              memory: Optional[TokenBufferMemory],
                                              model_config: ModelConfigWithCredentialsEntity) -> list[PromptMessage]:
        """
        Get completion model prompt messages.
        """
        raw_prompt = prompt_template.text

        prompt_messages = []

        prompt_template = PromptTemplateParser(template=raw_prompt, with_variable_tmpl=self.with_variable_tmpl)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        prompt_inputs = self._set_context_variable(context, prompt_template, prompt_inputs)

        if memory and memory_config:
            role_prefix = memory_config.role_prefix
            prompt_inputs = self._set_histories_variable(
                memory=memory,
                memory_config=memory_config,
                raw_prompt=raw_prompt,
                role_prefix=role_prefix,
                prompt_template=prompt_template,
                prompt_inputs=prompt_inputs,
                model_config=model_config
            )

        if query:
            prompt_inputs = self._set_query_variable(query, prompt_template, prompt_inputs)

        prompt = prompt_template.format(
            prompt_inputs
        )

        if files:
            prompt_message_contents = [TextPromptMessageContent(data=prompt)]
            for file in files:
                prompt_message_contents.append(file.prompt_message_content)

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=prompt))

        return prompt_messages

    def _get_chat_model_prompt_messages(self,
                                        prompt_template: list[ChatModelMessage],
                                        inputs: dict,
                                        query: Optional[str],
                                        files: list[FileVar],
                                        context: Optional[str],
                                        memory_config: Optional[MemoryConfig],
                                        memory: Optional[TokenBufferMemory],
                                        model_config: ModelConfigWithCredentialsEntity) -> list[PromptMessage]:
        """
        Get chat model prompt messages.
        """
        raw_prompt_list = prompt_template

        prompt_messages = []

        for prompt_item in raw_prompt_list:
            raw_prompt = prompt_item.text

            prompt_template = PromptTemplateParser(template=raw_prompt, with_variable_tmpl=self.with_variable_tmpl)
            prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

            prompt_inputs = self._set_context_variable(context, prompt_template, prompt_inputs)

            prompt = prompt_template.format(
                prompt_inputs
            )

            if prompt_item.role == PromptMessageRole.USER:
                prompt_messages.append(UserPromptMessage(content=prompt))
            elif prompt_item.role == PromptMessageRole.SYSTEM and prompt:
                prompt_messages.append(SystemPromptMessage(content=prompt))
            elif prompt_item.role == PromptMessageRole.ASSISTANT:
                prompt_messages.append(AssistantPromptMessage(content=prompt))

        if memory and memory_config:
            prompt_messages = self._append_chat_histories(memory, memory_config, prompt_messages, model_config)

            if files:
                prompt_message_contents = [TextPromptMessageContent(data=query)]
                for file in files:
                    prompt_message_contents.append(file.prompt_message_content)

                prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
            else:
                prompt_messages.append(UserPromptMessage(content=query))
        elif files:
            if not query:
                # get last message
                last_message = prompt_messages[-1] if prompt_messages else None
                if last_message and last_message.role == PromptMessageRole.USER:
                    # get last user message content and add files
                    prompt_message_contents = [TextPromptMessageContent(data=last_message.content)]
                    for file in files:
                        prompt_message_contents.append(file.prompt_message_content)

                    last_message.content = prompt_message_contents
                else:
                    prompt_message_contents = [TextPromptMessageContent(data='')]  # not for query
                    for file in files:
                        prompt_message_contents.append(file.prompt_message_content)

                    prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
            else:
                prompt_message_contents = [TextPromptMessageContent(data=query)]
                for file in files:
                    prompt_message_contents.append(file.prompt_message_content)

                prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        elif query:
            prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages

    def _set_context_variable(self, context: str, prompt_template: PromptTemplateParser, prompt_inputs: dict) -> dict:
        if '#context#' in prompt_template.variable_keys:
            if context:
                prompt_inputs['#context#'] = context
            else:
                prompt_inputs['#context#'] = ''

        return prompt_inputs

    def _set_query_variable(self, query: str, prompt_template: PromptTemplateParser, prompt_inputs: dict) -> dict:
        if '#query#' in prompt_template.variable_keys:
            if query:
                prompt_inputs['#query#'] = query
            else:
                prompt_inputs['#query#'] = ''

        return prompt_inputs

    def _set_histories_variable(self, memory: TokenBufferMemory,
                                memory_config: MemoryConfig,
                                raw_prompt: str,
                                role_prefix: MemoryConfig.RolePrefix,
                                prompt_template: PromptTemplateParser,
                                prompt_inputs: dict,
                                model_config: ModelConfigWithCredentialsEntity) -> dict:
        if '#histories#' in prompt_template.variable_keys:
            if memory:
                inputs = {'#histories#': '', **prompt_inputs}
                prompt_template = PromptTemplateParser(template=raw_prompt, with_variable_tmpl=self.with_variable_tmpl)
                prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
                tmp_human_message = UserPromptMessage(
                    content=prompt_template.format(prompt_inputs)
                )

                rest_tokens = self._calculate_rest_token([tmp_human_message], model_config)

                histories = self._get_history_messages_from_memory(
                    memory=memory,
                    memory_config=memory_config,
                    max_token_limit=rest_tokens,
                    human_prefix=role_prefix.user,
                    ai_prefix=role_prefix.assistant
                )
                prompt_inputs['#histories#'] = histories
            else:
                prompt_inputs['#histories#'] = ''

        return prompt_inputs
