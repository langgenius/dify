from typing import Optional

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.file import file_manager
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from extensions.ext_database import db
from factories import file_factory
from models.model import AppMode, Conversation, Message, MessageFile
from models.workflow import WorkflowRun


class TokenBufferMemory:
    def __init__(self, conversation: Conversation, model_instance: ModelInstance) -> None:
        self.conversation = conversation
        self.model_instance = model_instance

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: Optional[int] = None
    ) -> list[PromptMessage]:
        """
        Get history prompt messages.
        :param max_token_limit: max token limit
        :param message_limit: message limit
        """
        app_record = self.conversation.app

        # fetch limited messages, and return reversed
        query = (
            db.session.query(
                Message.id,
                Message.query,
                Message.answer,
                Message.created_at,
                Message.workflow_run_id,
                Message.parent_message_id,
            )
            .filter(
                Message.conversation_id == self.conversation.id,
            )
            .order_by(Message.created_at.desc())
        )

        if message_limit and message_limit > 0:
            message_limit = min(message_limit, 500)
        else:
            message_limit = 500

        messages = query.limit(message_limit).all()

        # instead of all messages from the conversation, we only need to extract messages
        # that belong to the thread of last message
        thread_messages = extract_thread_messages(messages)

        # for newly created message, its answer is temporarily empty, we don't need to add it to memory
        if thread_messages and not thread_messages[0].answer:
            thread_messages.pop(0)

        messages = list(reversed(thread_messages))

        prompt_messages = []
        for message in messages:
            files = db.session.query(MessageFile).filter(MessageFile.message_id == message.id).all()
            if files:
                file_extra_config = None
                if self.conversation.mode not in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
                    file_extra_config = FileUploadConfigManager.convert(self.conversation.model_config)
                else:
                    if message.workflow_run_id:
                        workflow_run = (
                            db.session.query(WorkflowRun).filter(WorkflowRun.id == message.workflow_run_id).first()
                        )

                        if workflow_run:
                            file_extra_config = FileUploadConfigManager.convert(
                                workflow_run.workflow.features_dict, is_vision=False
                            )

                if file_extra_config and app_record:
                    file_objs = file_factory.build_from_message_files(
                        message_files=files, tenant_id=app_record.tenant_id, config=file_extra_config
                    )
                else:
                    file_objs = []

                if not file_objs:
                    prompt_messages.append(UserPromptMessage(content=message.query))
                else:
                    prompt_message_contents: list[PromptMessageContent] = []
                    prompt_message_contents.append(TextPromptMessageContent(data=message.query))
                    for file_obj in file_objs:
                        prompt_message = file_manager.to_prompt_message_content(file_obj)
                        prompt_message_contents.append(prompt_message)

                    prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
            else:
                prompt_messages.append(UserPromptMessage(content=message.query))

            prompt_messages.append(AssistantPromptMessage(content=message.answer))

        if not prompt_messages:
            return []

        # prune the chat message if it exceeds the max token limit
        curr_message_tokens = self.model_instance.get_llm_num_tokens(prompt_messages)

        if curr_message_tokens > max_token_limit:
            pruned_memory = []
            while curr_message_tokens > max_token_limit and len(prompt_messages) > 1:
                pruned_memory.append(prompt_messages.pop(0))
                curr_message_tokens = self.model_instance.get_llm_num_tokens(prompt_messages)

        return prompt_messages

    def get_history_prompt_text(
        self,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
        max_token_limit: int = 2000,
        message_limit: Optional[int] = None,
    ) -> str:
        """
        Get history prompt text.
        :param human_prefix: human prefix
        :param ai_prefix: ai prefix
        :param max_token_limit: max token limit
        :param message_limit: message limit
        :return:
        """
        prompt_messages = self.get_history_prompt_messages(max_token_limit=max_token_limit, message_limit=message_limit)

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
