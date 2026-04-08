import logging
from typing import cast

from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

from core.app.entities.app_invoke_entities import (
    ModelConfigWithCredentialsEntity,
)
from core.llm_generator.prompts import HISTORY_COMPRESSION_SUMMARY_PROMPT
from core.memory.token_buffer_memory import TokenBufferMemory
from core.prompt.prompt_transform import PromptTransform

logger = logging.getLogger(__name__)


class AgentHistoryPromptTransform(PromptTransform):
    """
    History Prompt Transform for Agent App
    """

    def __init__(
        self,
        model_config: ModelConfigWithCredentialsEntity,
        prompt_messages: list[PromptMessage],
        history_messages: list[PromptMessage],
        memory: TokenBufferMemory | None = None,
    ):
        self.model_config = model_config
        self.prompt_messages = prompt_messages
        self.history_messages = history_messages
        self.memory = memory

    def get_prompt(self) -> list[PromptMessage]:
        prompt_messages: list[PromptMessage] = []
        num_system = 0
        for prompt_message in self.history_messages:
            if isinstance(prompt_message, SystemPromptMessage):
                prompt_messages.append(prompt_message)
                num_system += 1

        if not self.memory:
            return prompt_messages

        max_token_limit = self._calculate_rest_token(self.prompt_messages, model_config=self.model_config)

        model_type_instance = self.model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        curr_message_tokens = model_type_instance.get_num_tokens(
            self.model_config.model,
            self.model_config.credentials,
            self.history_messages,
        )
        if curr_message_tokens <= max_token_limit:
            return self.history_messages

        # number of prompt has been appended in current message
        num_prompt = 0
        dropped = False
        # append prompt messages in desc order
        for prompt_message in self.history_messages[::-1]:
            if isinstance(prompt_message, SystemPromptMessage):
                continue
            prompt_messages.append(prompt_message)
            num_prompt += 1
            # a message is start with UserPromptMessage
            if isinstance(prompt_message, UserPromptMessage):
                curr_message_tokens = model_type_instance.get_num_tokens(
                    self.model_config.model,
                    self.model_config.credentials,
                    prompt_messages,
                )
                # if current message token is overflow, drop all the prompts in current message and break
                if curr_message_tokens > max_token_limit:
                    prompt_messages = prompt_messages[:-num_prompt]
                    dropped = True
                    break
                num_prompt = 0

        if dropped:
            kept_ids = {id(m) for m in prompt_messages[num_system:]}
            messages_to_summarize = [
                m for m in self.history_messages if not isinstance(m, SystemPromptMessage) and id(m) not in kept_ids
            ]
            if messages_to_summarize:
                try:
                    summary = self._summarize_messages(messages_to_summarize)
                    if summary:
                        summary_message = SystemPromptMessage(content=f"[Earlier conversation summary]\n{summary}")
                        prompt_messages.insert(num_system, summary_message)
                        num_system += 1
                except Exception:
                    logger.exception("Failed to summarize conversation history, dropping oldest messages instead")

        # return prompt messages in asc order
        message_prompts = prompt_messages[num_system:]
        message_prompts.reverse()

        # merge system and message prompt
        prompt_messages = prompt_messages[:num_system]
        prompt_messages.extend(message_prompts)
        return prompt_messages

    def _summarize_messages(self, messages: list[PromptMessage]) -> str:
        """
        Summarize the given conversation messages using the memory model instance.
        Uses a second LLM invocation to produce a concise summary of the messages
        that would otherwise be dropped due to context window limits.
        :param messages: list of prompt messages to summarize
        :return: summary string, empty string if nothing to summarize
        """
        if not self.memory:
            return ""
        # Build a plain-text conversation transcript from the messages
        conversation_lines: list[str] = []
        for msg in messages:
            if isinstance(msg, UserPromptMessage):
                if isinstance(msg.content, str):
                    conversation_lines.append(f"Human: {msg.content}")
                elif isinstance(msg.content, list):
                    text_parts = [c.data for c in msg.content if isinstance(c, TextPromptMessageContent)]
                    if text_parts:
                        conversation_lines.append(f"Human: {' '.join(text_parts)}")
            elif isinstance(msg, AssistantPromptMessage):
                if isinstance(msg.content, str) and msg.content:
                    conversation_lines.append(f"Assistant: {msg.content}")
        conversation_text = "\n".join(conversation_lines)
        if not conversation_text.strip():
            return ""
        summary_prompt = HISTORY_COMPRESSION_SUMMARY_PROMPT.format(conversation=conversation_text)
        result = self.memory.model_instance.invoke_llm(
            prompt_messages=[UserPromptMessage(content=summary_prompt)],
            model_parameters={"max_tokens": 800, "temperature": 0.3},
            stream=False,
        )
        return result.message.get_text_content()
