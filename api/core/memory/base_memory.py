from abc import ABC, abstractmethod
from collections.abc import Sequence

from core.model_runtime.entities.message_entities import PromptMessage


class BaseMemory(ABC):
    @abstractmethod
    def get_history_prompt_messages(self) -> Sequence[PromptMessage]:
        """
        Get the history prompt messages
        """

    @abstractmethod
    def get_history_prompt_text(self) -> str:
        """
        Get the history prompt text
        """
