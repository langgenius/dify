"""
Base memory interfaces and types.

This module defines the common protocol for memory implementations.
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence

from core.model_runtime.entities import ImagePromptMessageContent, PromptMessage


class BaseMemory(ABC):
    """
    Abstract base class for memory implementations.

    Provides a common interface for both conversation-level and node-level memory.
    """

    @abstractmethod
    def get_history_prompt_messages(
        self,
        *,
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> Sequence[PromptMessage]:
        """
        Get history prompt messages.

        :param max_token_limit: Maximum tokens for history
        :param message_limit: Maximum number of messages
        :return: Sequence of PromptMessage for LLM context
        """
        pass

    def get_history_prompt_text(
        self,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> str:
        """
        Get history prompt as formatted text.

        :param human_prefix: Prefix for human messages
        :param ai_prefix: Prefix for assistant messages
        :param max_token_limit: Maximum tokens for history
        :param message_limit: Maximum number of messages
        :return: Formatted history text
        """
        from core.model_runtime.entities import (
            PromptMessageRole,
            TextPromptMessageContent,
        )

        prompt_messages = self.get_history_prompt_messages(
            max_token_limit=max_token_limit,
            message_limit=message_limit,
        )

        string_messages = []
        for m in prompt_messages:
            if m.role == PromptMessageRole.USER:
                role = human_prefix
            elif m.role == PromptMessageRole.ASSISTANT:
                role = ai_prefix
            else:
                continue

            if isinstance(m.content, list):
                inner_msg = ""
                for content in m.content:
                    if isinstance(content, TextPromptMessageContent):
                        inner_msg += f"{content.data}\n"
                    elif isinstance(content, ImagePromptMessageContent):
                        inner_msg += "[image]\n"
                string_messages.append(f"{role}: {inner_msg.strip()}")
            else:
                message = f"{role}: {m.content}"
                string_messages.append(message)

        return "\n".join(string_messages)
