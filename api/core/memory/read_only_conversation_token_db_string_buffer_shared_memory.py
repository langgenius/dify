from typing import Any, List, Dict

from langchain.memory.chat_memory import BaseChatMemory
from langchain.schema import get_buffer_string, BaseMessage, BaseLanguageModel

from core.memory.read_only_conversation_token_db_buffer_shared_memory import \
    ReadOnlyConversationTokenDBBufferSharedMemory


class ReadOnlyConversationTokenDBStringBufferSharedMemory(BaseChatMemory):
    memory: ReadOnlyConversationTokenDBBufferSharedMemory

    @property
    def memory_variables(self) -> List[str]:
        """Return memory variables."""
        return self.memory.memory_variables

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, str]:
        """Load memory variables from memory."""
        buffer: Any = self.memory.buffer

        final_buffer = get_buffer_string(
            buffer,
            human_prefix=self.memory.human_prefix,
            ai_prefix=self.memory.ai_prefix,
        )

        return {self.memory.memory_key: final_buffer}

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, str]) -> None:
        """Nothing should be saved or changed"""
        pass

    def clear(self) -> None:
        """Nothing to clear, got a memory like a vault."""
        pass