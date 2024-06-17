from typing import Optional

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.file.message_file_parser import MessageFileParser
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from extensions.ext_database import db
from models.model import AppMode, Conversation, Message


class TokenBufferMemory:
    def __init__(self, conversation: Conversation, model_instance: ModelInstance) -> None:
        self.conversation = conversation
        self.model_instance = model_instance

    def get_history_prompt_messages(self, max_token_limit: int = 2000,
                                    message_limit: Optional[int] = None) -> list[PromptMessage]:
        """
        Get history prompt messages.
        :param max_token_limit: max token limit
        :param message_limit: message limit
        """
        app_record = self.conversation.app

        # fetch limited messages, and return reversed
        query = db.session.query(Message).filter(
            Message.conversation_id == self.conversation.id,
            Message.answer != ''
        ).order_by(Message.created_at.desc())

        if message_limit and message_limit > 0:
            messages = query.limit(message_limit).all()
        else:
            messages = query.all()

        messages = list(reversed(messages))
        message_file_parser = MessageFileParser(
            tenant_id=app_record.tenant_id,
            app_id=app_record.id
        )

        prompt_messages = []
        for message in messages:
            files = message.message_files
            if files:
                if self.conversation.mode not in [AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value]:
                    file_extra_config = FileUploadConfigManager.convert(message.app_model_config.to_dict())
                else:
                    file_extra_config = FileUploadConfigManager.convert(
                        message.workflow_run.workflow.features_dict,
                        is_vision=False
                    )

                if file_extra_config:
                    file_objs = message_file_parser.transform_message_files(
                        files,
                        file_extra_config
                    )
                else:
                    file_objs = []

                if not file_objs:
                    prompt_messages.append(UserPromptMessage(content=message.query))
                else:
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
        curr_message_tokens = self.model_instance.get_llm_num_tokens(
            prompt_messages
        )

        if curr_message_tokens > max_token_limit:
            pruned_memory = []
            while curr_message_tokens > max_token_limit and prompt_messages:
                pruned_memory.append(prompt_messages.pop(0))
                curr_message_tokens = self.model_instance.get_llm_num_tokens(
                    prompt_messages
                )

        return prompt_messages

    def get_history_prompt_text(self, human_prefix: str = "Human",
                                ai_prefix: str = "Assistant",
                                max_token_limit: int = 2000,
                                message_limit: Optional[int] = None) -> str:
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