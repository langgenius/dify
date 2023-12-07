from typing import Any, List, Dict

from langchain.memory.chat_memory import BaseChatMemory
from langchain.schema import get_buffer_string, BaseMessage

from core.file.message_file_parser import MessageFileParser
from core.model_providers.models.entity.message import PromptMessage, MessageType, to_lc_messages
from core.model_providers.models.llm.base import BaseLLM
from extensions.ext_database import db
from models.model import Conversation, Message


class ReadOnlyConversationTokenDBBufferSharedMemory(BaseChatMemory):
    conversation: Conversation
    human_prefix: str = "Human"
    ai_prefix: str = "Assistant"
    model_instance: BaseLLM
    memory_key: str = "chat_history"
    max_token_limit: int = 2000
    message_limit: int = 10

    @property
    def buffer(self) -> List[BaseMessage]:
        """String buffer of memory."""
        app_model = self.conversation.app

        # fetch limited messages desc, and return reversed
        messages = db.session.query(Message).filter(
            Message.conversation_id == self.conversation.id,
            Message.answer_tokens > 0
        ).order_by(Message.created_at.desc()).limit(self.message_limit).all()

        messages = list(reversed(messages))
        message_file_parser = MessageFileParser(tenant_id=app_model.tenant_id, app_id=self.conversation.app_id)

        chat_messages: List[PromptMessage] = []
        for message in messages:
            files = message.message_files
            if files:
                file_objs = message_file_parser.transform_message_files(
                    files, message.app_model_config
                )

                prompt_message_files = [file_obj.prompt_message_file for file_obj in file_objs]
                chat_messages.append(PromptMessage(
                    content=message.query,
                    type=MessageType.USER,
                    files=prompt_message_files
                ))
            else:
                chat_messages.append(PromptMessage(content=message.query, type=MessageType.USER))

            chat_messages.append(PromptMessage(content=message.answer, type=MessageType.ASSISTANT))

        if not chat_messages:
            return []

        # prune the chat message if it exceeds the max token limit
        curr_buffer_length = self.model_instance.get_num_tokens(chat_messages)
        if curr_buffer_length > self.max_token_limit:
            pruned_memory = []
            while curr_buffer_length > self.max_token_limit and chat_messages:
                pruned_memory.append(chat_messages.pop(0))
                curr_buffer_length = self.model_instance.get_num_tokens(chat_messages)

        return to_lc_messages(chat_messages)

    @property
    def memory_variables(self) -> List[str]:
        """Will always return list of memory variables.

        :meta private:
        """
        return [self.memory_key]

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Return history buffer."""
        buffer: Any = self.buffer
        if self.return_messages:
            final_buffer: Any = buffer
        else:
            final_buffer = get_buffer_string(
                buffer,
                human_prefix=self.human_prefix,
                ai_prefix=self.ai_prefix,
            )
        return {self.memory_key: final_buffer}

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, str]) -> None:
        """Nothing should be saved or changed"""
        pass

    def clear(self) -> None:
        """Nothing to clear, got a memory like a vault."""
        pass
