from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.file_access import DatabaseFileAccessController
from core.model_manager import ModelInstance
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from extensions.ext_database import db
from factories import file_factory
from graphon.file import FileTransferMethod, FileType, FileUploadConfig, file_manager
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.entities.message_entities import PromptMessageContentUnionTypes
from models.model import App, AppMode, Conversation, Message, MessageFile
from models.workflow import Workflow
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory

_file_access_controller = DatabaseFileAccessController()


@dataclass(frozen=True)
class HistoryFile:
    """Persisted attachment reference; metadata and content are resolved after loading history."""

    id: str
    type: FileType
    transfer_method: FileTransferMethod
    url: str | None
    upload_file_id: str | None

    @classmethod
    def from_record(cls, record: MessageFile) -> "HistoryFile":
        return cls(record.id, record.type, record.transfer_method, record.url, record.upload_file_id)


@dataclass(frozen=True)
class HistoryPrompt:
    text: str
    is_user_message: bool
    files: tuple[HistoryFile, ...]
    tenant_id: str | None
    image_detail: ImagePromptMessageContent.DETAIL

    def to_prompt_message(self) -> PromptMessage:
        contents: list[PromptMessageContentUnionTypes] = []
        if self.files and self.tenant_id is not None:
            for reference in self.files:
                file = file_factory.build_from_mapping(
                    mapping={
                        "id": reference.id,
                        "type": reference.type,
                        "transfer_method": reference.transfer_method,
                        "url": reference.url,
                        "tool_file_id"
                        if reference.transfer_method == FileTransferMethod.TOOL_FILE
                        else "upload_file_id": reference.upload_file_id,
                    },
                    tenant_id=self.tenant_id,
                    access_controller=_file_access_controller,
                )
                contents.append(file_manager.to_prompt_message_content(file, image_detail_config=self.image_detail))

        if contents:
            contents.append(TextPromptMessageContent(data=self.text))
        content = contents or self.text
        if self.is_user_message:
            return UserPromptMessage(content=content)
        return AssistantPromptMessage(content=content)


@dataclass(frozen=True)
class PreparedHistory:
    """Detached history that can restore attachments and count tokens without its read session.

    File factories retain ownership of their short metadata lookups. Rendering may
    perform storage/network I/O, so callers should first close the history session.
    """

    prompts: tuple[HistoryPrompt, ...]

    def get_prompt_messages(self, *, model_instance: ModelInstance, max_token_limit: int) -> Sequence[PromptMessage]:
        prompt_messages = [prompt.to_prompt_message() for prompt in self.prompts]
        if not prompt_messages:
            return []

        curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)
        while curr_message_tokens > max_token_limit and len(prompt_messages) > 1:
            prompt_messages.pop(0)
            curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)
        return prompt_messages

    def get_prompt_text(
        self,
        *,
        model_instance: ModelInstance,
        max_token_limit: int,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
    ) -> str:
        prompt_messages = self.get_prompt_messages(model_instance=model_instance, max_token_limit=max_token_limit)
        return _prompt_messages_to_text(prompt_messages, human_prefix=human_prefix, ai_prefix=ai_prefix)


def _prompt_messages_to_text(prompt_messages: Sequence[PromptMessage], *, human_prefix: str, ai_prefix: str) -> str:
    string_messages = []
    for message in prompt_messages:
        if message.role == PromptMessageRole.USER:
            role = human_prefix
        elif message.role == PromptMessageRole.ASSISTANT:
            role = ai_prefix
        else:
            continue

        if isinstance(message.content, list):
            inner_msg = ""
            for content in message.content:
                match content:
                    case TextPromptMessageContent():
                        inner_msg += f"{content.data}\n"
                    case ImagePromptMessageContent():
                        inner_msg += "[image]\n"
            string_messages.append(f"{role}: {inner_msg.strip()}")
        else:
            string_messages.append(f"{role}: {message.content}")
    return "\n".join(string_messages)


class TokenBufferMemory:
    def __init__(
        self,
        conversation: Conversation,
        model_instance: ModelInstance,
    ) -> None:
        self.conversation = conversation
        self.model_instance = model_instance

    @staticmethod
    def _file_config(
        *,
        conversation: Conversation,
        app_record: App | None,
        message: Message,
        session: Session,
        workflow_run_repo: APIWorkflowRunRepository | None,
    ) -> FileUploadConfig | None:
        match conversation.mode:
            case AppMode.AGENT_CHAT | AppMode.COMPLETION | AppMode.CHAT:
                return FileUploadConfigManager.convert(conversation.model_config_with_session(session=session))
            case AppMode.ADVANCED_CHAT | AppMode.WORKFLOW:
                if not app_record:
                    raise ValueError("App not found for conversation")
                if not message.workflow_run_id:
                    raise ValueError("Workflow run ID not found")
                assert workflow_run_repo is not None
                workflow_run = workflow_run_repo.get_workflow_run_by_id(
                    tenant_id=app_record.tenant_id, app_id=app_record.id, run_id=message.workflow_run_id
                )
                if not workflow_run:
                    raise ValueError(f"Workflow run not found: {message.workflow_run_id}")
                workflow = session.scalar(select(Workflow).where(Workflow.id == workflow_run.workflow_id))
                if not workflow:
                    raise ValueError(f"Workflow not found: {workflow_run.workflow_id}")
                return FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
            case _:
                raise AssertionError(f"Invalid app mode: {conversation.mode}")

    @staticmethod
    def _prepare_prompt(
        *,
        message_files: Sequence[MessageFile],
        text_content: str,
        app_record: App | None,
        is_user_message: bool,
        file_config: FileUploadConfig | None,
    ) -> HistoryPrompt:
        detail = ImagePromptMessageContent.DETAIL.HIGH
        files: tuple[HistoryFile, ...] = ()
        if file_config and app_record:
            files = tuple(HistoryFile.from_record(message_file) for message_file in message_files)
            if file_config.image_config and file_config.image_config.detail:
                detail = file_config.image_config.detail
        return HistoryPrompt(
            text=text_content,
            is_user_message=is_user_message,
            files=files,
            tenant_id=app_record.tenant_id if app_record else None,
            image_detail=detail,
        )

    @classmethod
    def load_history(
        cls,
        *,
        conversation: Conversation,
        app_record: App | None,
        session: Session,
        message_limit: int | None,
        workflow_run_repo: APIWorkflowRunRepository | None = None,
    ) -> PreparedHistory:
        """Read ordered history and attachment configuration without provider or file I/O.

        ``None`` for message_limit uses the existing 500-message ceiling. A missing
        app keeps text-only legacy history available; workflow attachments still
        require the app. An omitted workflow repository uses the configured factory.
        """
        # fetch limited messages, and return reversed
        stmt = select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at.desc())

        if message_limit and message_limit > 0:
            message_limit = min(message_limit, 500)
        else:
            message_limit = 500

        msg_limit_stmt = stmt.limit(message_limit)

        messages = session.scalars(msg_limit_stmt).all()

        # instead of all messages from the conversation, we only need to extract messages
        # that belong to the thread of last message
        thread_messages = extract_thread_messages(messages)

        # for newly created message, its answer is temporarily empty, we don't need to add it to memory
        if thread_messages and not thread_messages[0].answer and thread_messages[0].answer_tokens == 0:
            thread_messages.pop(0)

        messages = list(reversed(thread_messages))

        # Batch-load message files for the whole thread to avoid an N+1 query pattern.
        # Previously each message issued two MessageFile queries (user + assistant),
        # i.e. 2N+1 round-trips for N messages. We now use two batched queries keyed by
        # message_id, preserving the exact filter semantics (user files include rows
        # whose belongs_to is NULL).
        message_ids = [message.id for message in messages]
        user_files_by_message: dict[str, list[MessageFile]] = defaultdict(list)
        assistant_files_by_message: dict[str, list[MessageFile]] = defaultdict(list)
        if message_ids:
            for message_file in session.scalars(
                select(MessageFile).where(
                    MessageFile.message_id.in_(message_ids),
                    (MessageFile.belongs_to == "user") | (MessageFile.belongs_to.is_(None)),
                )
            ).all():
                user_files_by_message[message_file.message_id].append(message_file)

            for message_file in session.scalars(
                select(MessageFile).where(
                    MessageFile.message_id.in_(message_ids),
                    MessageFile.belongs_to == "assistant",
                )
            ).all():
                assistant_files_by_message[message_file.message_id].append(message_file)

        prompts: list[HistoryPrompt] = []
        for message in messages:
            user_files = user_files_by_message.get(message.id, [])
            assistant_files = assistant_files_by_message.get(message.id, [])
            if (
                (user_files or assistant_files)
                and conversation.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}
                and app_record is not None
                and message.workflow_run_id
                and workflow_run_repo is None
            ):
                session_maker = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
                workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
            file_config = (
                cls._file_config(
                    conversation=conversation,
                    app_record=app_record,
                    message=message,
                    session=session,
                    workflow_run_repo=workflow_run_repo,
                )
                if user_files or assistant_files
                else None
            )
            for files, text_content, is_user_message in (
                (user_files, message.query, True),
                (assistant_files, message.answer, False),
            ):
                prompts.append(
                    cls._prepare_prompt(
                        message_files=files,
                        text_content=text_content,
                        app_record=app_record,
                        is_user_message=is_user_message,
                        file_config=file_config,
                    )
                )
        return PreparedHistory(prompts=tuple(prompts))

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        history = self.load_history(
            conversation=self.conversation,
            app_record=self.conversation.app,
            session=db.session(),
            message_limit=message_limit,
        )
        return history.get_prompt_messages(model_instance=self.model_instance, max_token_limit=max_token_limit)

    def get_history_prompt_text(
        self,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
        max_token_limit: int = 2000,
        message_limit: int | None = None,
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

        return _prompt_messages_to_text(prompt_messages, human_prefix=human_prefix, ai_prefix=ai_prefix)
