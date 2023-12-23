from typing import cast

from core.entities.application_entities import ModelConfigEntity
from core.file.message_file_parser import MessageFileParser
from core.model_runtime.entities.message_entities import PromptMessage, TextPromptMessageContent, UserPromptMessage, \
    AssistantPromptMessage, PromptMessageRole
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from extensions.ext_database import db
from models.model import Conversation, Message


class TokenBufferMemory:
    def __init__(self, conversation: Conversation, model_config: ModelConfigEntity) -> None:
        self.conversation = conversation
        self.model_config = model_config

    def get_history_prompt_messages(self, max_token_limit: int = 2000,
                                    message_limit: int = 10) -> list[PromptMessage]:
        """
        Get history prompt messages.
        :param max_token_limit: max token limit
        :param message_limit: message limit
        """
        app_record = self.conversation.app

        # fetch limited messages, and return reversed
        messages = db.session.query(Message).filter(
            Message.conversation_id == self.conversation.id,
            Message.answer != ''
        ).order_by(Message.created_at.desc()).limit(message_limit).all()

        messages = list(reversed(messages))
        message_file_parser = MessageFileParser(
            tenant_id=app_record.tenant_id,
            app_id=app_record.id
        )

        prompt_messages = []
        for message in messages:
            files = message.message_files
            if files:
                file_objs = message_file_parser.transform_message_files(
                    files, message.app_model_config
                )

                prompt_message_contents = [TextPromptMessageContent(data=message.query)]
                for file_obj in file_objs:
                    prompt_message_contents.append(file_obj.prompt_message_content)

                prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
            else:
                prompt_messages.append(UserPromptMessage(content=message.query))

            prompt_messages.append(AssistantPromptMessage(content=message.answer))

        if not prompt_messages:
            return []

        # prune the chat message if it exceeds the max token limit
        model_type_instance = self.model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        curr_message_tokens = model_type_instance.get_num_tokens(
            self.model_config.model,
            prompt_messages
        )

        if curr_message_tokens > max_token_limit:
            pruned_memory = []
            while curr_message_tokens > max_token_limit and prompt_messages:
                pruned_memory.append(prompt_messages.pop(0))
                curr_message_tokens = model_type_instance.get_num_tokens(
                    self.model_config.model,
                    prompt_messages
                )

        return prompt_messages

    def get_history_prompt_text(self, human_prefix: str = "Human",
                                ai_prefix: str = "Assistant",
                                max_token_limit: int = 2000,
                                message_limit: int = 10) -> str:
        """
        Get history prompt text.
        :param human_prefix: human prefix
        :param ai_prefix: ai prefix
        :param max_token_limit: max token limit
        :param message_limit: message limit
        :return:
        """
        prompt_messages = self.get_history_prompt_messages(
            max_token_limit=max_token_limit,
            message_limit=message_limit
        )

        string_messages = []
        for m in prompt_messages:
            if m.role == PromptMessageRole.USER:
                role = human_prefix
            elif m.role == PromptMessageRole.ASSISTANT:
                role = ai_prefix
            else:
                continue

            message = f"{role}: {m.content}"
            string_messages.append(message)

        return "\n".join(string_messages)