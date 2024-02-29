from typing import Optional

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
from core.prompt.prompt_transform import PromptTransform
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_template_parser import PromptTemplateParser


class AdvancedPromptTransform(PromptTransform):
    """
    Advanced Prompt Transform for Workflow LLM Node.
    """

    def get_prompt(self, prompt_template_entity: PromptTemplateEntity,
                   inputs: dict,
                   query: str,
                   files: list[FileObj],
                   context: Optional[str],
                   memory: Optional[TokenBufferMemory],
                   model_config: ModelConfigEntity) -> list[PromptMessage]:
        prompt_messages = []

        model_mode = ModelMode.value_of(model_config.mode)
        if model_mode == ModelMode.COMPLETION:
            prompt_messages = self._get_completion_model_prompt_messages(
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )
        elif model_mode == ModelMode.CHAT:
            prompt_messages = self._get_chat_model_prompt_messages(
                prompt_template_entity=prompt_template_entity,
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config
            )

        return prompt_messages

    def _get_completion_model_prompt_messages(self,
                                              prompt_template_entity: PromptTemplateEntity,
                                              inputs: dict,
                                              query: Optional[str],
                                              files: list[FileObj],
                                              context: Optional[str],
                                              memory: Optional[TokenBufferMemory],
                                              model_config: ModelConfigEntity) -> list[PromptMessage]:
        """
        Get completion model prompt messages.
        """
        raw_prompt = prompt_template_entity.advanced_completion_prompt_template.prompt

        prompt_messages = []

        prompt_template = PromptTemplateParser(template=raw_prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        prompt_inputs = self._set_context_variable(context, prompt_template, prompt_inputs)

        role_prefix = prompt_template_entity.advanced_completion_prompt_template.role_prefix
        prompt_inputs = self._set_histories_variable(
            memory=memory,
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
                                        prompt_template_entity: PromptTemplateEntity,
                                        inputs: dict,
                                        query: Optional[str],
                                        files: list[FileObj],
                                        context: Optional[str],
                                        memory: Optional[TokenBufferMemory],
                                        model_config: ModelConfigEntity) -> list[PromptMessage]:
        """
        Get chat model prompt messages.
        """
        raw_prompt_list = prompt_template_entity.advanced_chat_prompt_template.messages

        prompt_messages = []

        for prompt_item in raw_prompt_list:
            raw_prompt = prompt_item.text

            prompt_template = PromptTemplateParser(template=raw_prompt)
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

        if memory:
            prompt_messages = self._append_chat_histories(memory, prompt_messages, model_config)

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
                                raw_prompt: str,
                                role_prefix: AdvancedCompletionPromptTemplateEntity.RolePrefixEntity,
                                prompt_template: PromptTemplateParser,
                                prompt_inputs: dict,
                                model_config: ModelConfigEntity) -> dict:
        if '#histories#' in prompt_template.variable_keys:
            if memory:
                inputs = {'#histories#': '', **prompt_inputs}
                prompt_template = PromptTemplateParser(raw_prompt)
                prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
                tmp_human_message = UserPromptMessage(
                    content=prompt_template.format(prompt_inputs)
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

        return prompt_inputs
