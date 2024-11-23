from typing import Optional, cast

from core.app.entities.app_invoke_entities import (
    ModelConfigWithCredentialsEntity,
)
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import (
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.prompt_transform import PromptTransform


class AgentHistoryPromptTransform(PromptTransform):
    """
    History Prompt Transform for Agent App
    """

    def __init__(
        self,
        model_config: ModelConfigWithCredentialsEntity,
        prompt_messages: list[PromptMessage],
        history_messages: list[PromptMessage],
        memory: Optional[TokenBufferMemory] = None,
    ):
        self.model_config = model_config
        self.prompt_messages = prompt_messages
        self.history_messages = history_messages
        self.memory = memory

    def get_prompt(self) -> list[PromptMessage]:
        prompt_messages = []
        num_system = 0
        for prompt_message in self.history_messages:
            if isinstance(prompt_message, SystemPromptMessage):
                prompt_messages.append(prompt_message)
                num_system += 1

        if not self.memory:
            return prompt_messages

        max_token_limit = self._calculate_rest_token(self.prompt_messages, self.model_config)

        model_type_instance = self.model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        curr_message_tokens = model_type_instance.get_num_tokens(
            self.memory.model_instance.model, self.memory.model_instance.credentials, self.history_messages
        )
        if curr_message_tokens <= max_token_limit:
            return self.history_messages

        # number of prompt has been appended in current message
        num_prompt = 0
        # append prompt messages in desc order
        for prompt_message in self.history_messages[::-1]:
            if isinstance(prompt_message, SystemPromptMessage):
                continue
            prompt_messages.append(prompt_message)
            num_prompt += 1
            # a message is start with UserPromptMessage
            if isinstance(prompt_message, UserPromptMessage):
                curr_message_tokens = model_type_instance.get_num_tokens(
                    self.memory.model_instance.model, self.memory.model_instance.credentials, prompt_messages
                )
                # if current message token is overflow, drop all the prompts in current message and break
                if curr_message_tokens > max_token_limit:
                    prompt_messages = prompt_messages[:-num_prompt]
                    break
                num_prompt = 0
        # return prompt messages in asc order
        message_prompts = prompt_messages[num_system:]
        message_prompts.reverse()

        # merge system and message prompt
        prompt_messages = prompt_messages[:num_system]
        prompt_messages.extend(message_prompts)
        return prompt_messages
