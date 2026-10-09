"""Persist and load messages for one admitted application invocation."""

import json
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.memory.token_buffer_memory import PreparedHistory, TokenBufferMemory
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.prompt.utils.get_thread_messages_length import get_thread_messages_length
from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, MessageFileBelongsTo, MessageStatus
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from models.model import (
    Account,
    AnnotationReplyConfig,
    App,
    AppMode,
    AppModelConfig,
    Conversation,
    EndUser,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageFile,
    UploadFile,
    load_annotation_reply_config,
)
from repositories.human_input.form_repository import HumanInputFormRepositoryImpl
from repositories.knowledge.upload_file_repository import query_upload_files
from services.agent.log_contracts import (
    AgentLogAppNotFoundError,
    AgentLogConfigurationError,
    AgentLogNotFoundError,
    AgentLogSnapshot,
    AgentLogThought,
)
from services.app.generation.ports import (
    AgentHistoryMessage,
    ChatRecordSeed,
    ConversationSnapshot,
    MessageIdentity,
    MessageUpdate,
)
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError


class AppGenerationRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def image_uploads(self, *, tenant_id: str, upload_ids: Sequence[str]) -> list[File]:
        with self._sessions() as session:
            uploads = query_upload_files(session, workspace_id=tenant_id, file_ids=upload_ids)
            return [
                File(
                    file_id=upload.id,
                    filename=upload.name,
                    extension="." + upload.extension,
                    mime_type=upload.mime_type,
                    file_type=FileType.IMAGE,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    remote_url=upload.source_url,
                    reference=build_file_reference(record_id=upload.id),
                    size=upload.size,
                    storage_key=upload.key,
                )
                for file_id in dict.fromkeys(upload_ids)
                if (upload := uploads.get(file_id)) is not None and (upload.mime_type or "").startswith("image/")
            ]

    def agent_log(
        self, *, tenant_id: str, account_id: str, app_id: str, conversation_id: str, message_id: str
    ) -> AgentLogSnapshot:
        with self._sessions() as session:
            app = session.scalar(
                select(App).where(App.id == app_id, App.tenant_id == tenant_id, App.mode == AppMode.AGENT_CHAT)
            )
            if app is None:
                raise AgentLogAppNotFoundError()
            conversation = session.scalar(
                select(Conversation).where(Conversation.id == conversation_id, Conversation.app_id == app_id)
            )
            if conversation is None:
                raise AgentLogNotFoundError(f"Conversation not found: {conversation_id}")
            message = session.scalar(
                select(Message).where(
                    Message.id == message_id, Message.conversation_id == conversation_id, Message.app_id == app_id
                )
            )
            if message is None:
                raise AgentLogNotFoundError(f"Message not found: {message_id}")
            config = session.scalar(
                select(AppModelConfig).where(
                    AppModelConfig.id == app.app_model_config_id, AppModelConfig.app_id == app_id
                )
            )
            if config is None:
                raise AgentLogConfigurationError("App model config not found")
            if conversation.from_end_user_id:
                executor = session.scalar(
                    select(EndUser.name).where(
                        EndUser.id == conversation.from_end_user_id,
                        EndUser.tenant_id == tenant_id,
                        EndUser.app_id == app_id,
                    )
                )
            else:
                executor = session.scalar(select(Account.name).where(Account.id == conversation.from_account_id))
            timezone = session.scalar(select(Account.timezone).where(Account.id == account_id))
            thoughts = [
                AgentLogThought(
                    tokens=thought.tokens,
                    tools=thought.tools,
                    labels=thought.tool_labels,
                    metadata=thought.tool_meta,
                    inputs=thought.tool_inputs_dict,
                    outputs=thought.tool_outputs_dict,
                    raw_input=thought.tool_input,
                    raw_output=thought.observation,
                    thought=thought.thought,
                    created_at=thought.created_at,
                    files=thought.files,
                )
                for thought in message.agent_thoughts_with_session(session=session)
            ]
            files = [
                {
                    "id": file.id,
                    "type": file.type,
                    "transfer_method": file.transfer_method,
                    "upload_file_id": file.upload_file_id,
                    "url": file.url,
                    "belongs_to": file.belongs_to,
                }
                for file in session.scalars(select(MessageFile).where(MessageFile.message_id == message_id))
            ]
            return AgentLogSnapshot(
                executor=executor or "Unknown",
                timezone=timezone or "UTC",
                created_at=message.created_at,
                elapsed_time=message.provider_response_latency,
                total_tokens=message.answer_tokens + message.message_tokens,
                model_config=config.to_dict(annotation_reply=load_annotation_reply_config(session, app_id)),
                thoughts=thoughts,
                files=files,
            )

    def history(
        self, *, tenant_id: str, app_id: str, conversation_id: str, message_limit: int | None
    ) -> PreparedHistory:
        with self._sessions() as session:
            row = session.execute(
                select(Conversation, App)
                .join(App, App.id == Conversation.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    App.id == app_id,
                    Conversation.id == conversation_id,
                    Conversation.is_deleted.is_(False),
                )
            ).one_or_none()
            if row is None:
                return PreparedHistory(prompts=())
            conversation, app = row
            return TokenBufferMemory.load_history(
                conversation=conversation,
                app_record=app,
                session=session,
                message_limit=message_limit,
            )

    @staticmethod
    def _conversation(
        session: Session, *, app_id: str, conversation_id: str, account_id: str | None, end_user_id: str | None
    ):
        return session.scalar(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.app_id == app_id,
                Conversation.from_source == ("api" if end_user_id is not None else "console"),
                Conversation.from_end_user_id == end_user_id,
                Conversation.from_account_id == account_id,
                Conversation.is_deleted.is_(False),
            )
        )

    def conversation(
        self, *, app_id: str, conversation_id: str, account_id: str | None, end_user_id: str | None
    ) -> Conversation:
        with self._sessions() as session:
            conversation = self._conversation(
                session, app_id=app_id, conversation_id=conversation_id, account_id=account_id, end_user_id=end_user_id
            )
            if conversation is None:
                raise ConversationNotExistsError()
            session.expunge(conversation)
            return conversation

    def initialize(
        self, *, tenant_id: str, app_id: str, conversation_id: str | None, seed: ChatRecordSeed
    ) -> tuple[Conversation, Message]:
        with self._sessions.begin() as session:
            if session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id)) is None:
                raise ConversationNotExistsError("Conversation app not found")
            if conversation_id is None:
                conversation = Conversation(**{**seed.conversation, "app_id": app_id})
                session.add(conversation)
                session.flush()
            else:
                conversation = self._conversation(
                    session,
                    app_id=app_id,
                    conversation_id=conversation_id,
                    account_id=seed.conversation["from_account_id"],
                    end_user_id=seed.conversation["from_end_user_id"],
                )
                if conversation is None:
                    raise ConversationNotExistsError()
                conversation.updated_at = naive_utc_now()
            message = Message(**{**seed.message, "app_id": app_id, "conversation_id": conversation.id})
            session.add(message)
            session.flush()
            session.add_all(MessageFile(message_id=message.id, **fields) for fields in seed.files)
            session.refresh(conversation)
            session.refresh(message)
            session.expunge(conversation)
            session.expunge(message)
            return conversation, message

    def model_config(self, *, tenant_id: str, app_id: str, config_id: str | None) -> AppModelConfig:
        with self._sessions() as session:
            config = session.scalar(
                select(AppModelConfig)
                .join(App, App.id == AppModelConfig.app_id)
                .where(App.tenant_id == tenant_id, App.id == app_id, AppModelConfig.id == config_id)
            )
            if config is None:
                raise AppModelConfigBrokenError()
            return config

    def annotation_config(self, *, tenant_id: str, app_id: str) -> AnnotationReplyConfig:
        with self._sessions() as session:
            if session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id)) is None:
                raise ConversationNotExistsError("Conversation app not found")
            return load_annotation_reply_config(session, app_id)

    def regeneration_message(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        account_id: str | None,
        end_user_id: str | None,
    ) -> tuple[Conversation, Message, dict[str, Any]]:
        with self._sessions() as session:
            row = session.execute(
                select(Conversation, Message)
                .join(Message, Message.conversation_id == Conversation.id)
                .join(App, App.id == Conversation.app_id)
                .where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    Message.app_id == app_id,
                    Message.id == message_id,
                    Message.from_source == ("api" if end_user_id is not None else "console"),
                    Message.from_account_id == account_id,
                    Message.from_end_user_id == end_user_id,
                )
            ).one_or_none()
            if row is None:
                raise MessageNotExistsError()
            conversation, message = row
            return conversation, message, message.inputs_with_session(session=session)

    def latest_query(self, *, tenant_id: str, app_id: str, conversation_id: str) -> str | None:
        with self._sessions() as session:
            return session.scalar(
                select(Message.query)
                .join(App, App.id == Message.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    Message.app_id == app_id,
                    Message.conversation_id == conversation_id,
                    Message.query != "",
                )
                .order_by(Message.created_at.desc())
                .limit(1)
            )

    def dialogue_count(self, conversation_id: str) -> int:
        with self._sessions() as session:
            return get_thread_messages_length(conversation_id, session=session) + 1

    def load(
        self, *, tenant_id: str, app_id: str, conversation_id: str, message_id: str
    ) -> tuple[App, Conversation, Message]:
        with self._sessions() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
            if app is None:
                raise ConversationNotExistsError("Conversation app not found")
            conversation = session.scalar(
                select(Conversation).where(Conversation.id == conversation_id, Conversation.app_id == app_id)
            )
            if conversation is None:
                raise ConversationNotExistsError()
            message = session.scalar(
                select(Message).where(
                    Message.id == message_id,
                    Message.app_id == app_id,
                    Message.conversation_id == conversation_id,
                )
            )
            if message is None:
                raise MessageNotExistsError()
            session.expunge_all()
            return app, conversation, message

    @staticmethod
    def _message(session: Session, identity: MessageIdentity) -> Message:
        message = session.scalar(
            select(Message)
            .join(App, App.id == Message.app_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                App.tenant_id == identity.tenant_id,
                Conversation.app_id == identity.app_id,
                Message.app_id == identity.app_id,
                Message.conversation_id == identity.conversation_id,
                Message.id == identity.message_id,
            )
            .with_for_update(of=Message)
        )
        if message is None:
            raise MessageNotExistsError()
        return message

    def attach_workflow(self, identity: MessageIdentity, workflow_run_id: str) -> None:
        with self._sessions.begin() as session:
            try:
                message = self._message(session, identity)
            except MessageNotExistsError:
                # Deleting a conversation while streaming must not suppress engine events.
                return
            # Run persistence may be asynchronous; ownership is supplied by the admitted execution.
            message.workflow_run_id = workflow_run_id

    def save_message(self, identity: MessageIdentity, update: MessageUpdate) -> Message:
        with self._sessions.begin() as session:
            message = self._message(session, identity)
            if update.paused:
                message.status = MessageStatus.PAUSED
            elif message.status == MessageStatus.PAUSED:
                message.status = MessageStatus.NORMAL
            message.answer = update.answer
            message.updated_at = naive_utc_now()
            preserve_usage = update.preserve_existing_usage and (
                int(message.message_tokens or 0) + int(message.answer_tokens or 0) > 0 or bool(message.total_price)
            )
            if update.prompt is not None:
                object.__setattr__(message, "message", list(update.prompt))
            if not preserve_usage:
                message.provider_response_latency = update.latency
            if update.usage is not None and not preserve_usage:
                self._apply_usage(message, update.usage)
            metadata = dict(update.metadata)
            if preserve_usage:
                previous = self._metadata(message)
                if "usage" in previous:
                    metadata["usage"] = previous["usage"]
            message.message_metadata = json.dumps(jsonable_encoder(metadata), ensure_ascii=False)
            session.add_all(
                MessageFile(
                    message_id=message.id,
                    **fields,
                    belongs_to=MessageFileBelongsTo.ASSISTANT,
                    created_by_role=CreatorUserRole.ACCOUNT
                    if message.invoke_from in {"explore", "debugger"}
                    else CreatorUserRole.END_USER,
                    created_by=message.from_account_id or message.from_end_user_id or "",
                )
                for fields in update.files
            )
            session.flush()
            session.refresh(message)
            session.expunge(message)
            return message

    @staticmethod
    def _metadata(message: Message) -> dict[str, Any]:
        try:
            metadata = json.loads(message.message_metadata) if message.message_metadata else {}
        except (json.JSONDecodeError, TypeError):
            return {}
        return metadata if isinstance(metadata, dict) else {}

    def message_files(self, identity: MessageIdentity) -> tuple[list[MessageFile], dict[str, UploadFile]]:
        with self._sessions() as session:
            files = list(
                session.scalars(
                    select(MessageFile)
                    .join(Message, Message.id == MessageFile.message_id)
                    .join(App, App.id == Message.app_id)
                    .where(
                        App.tenant_id == identity.tenant_id,
                        App.id == identity.app_id,
                        Message.conversation_id == identity.conversation_id,
                        Message.id == identity.message_id,
                    )
                )
            )
            upload_ids = [
                file.upload_file_id
                for file in files
                if file.transfer_method == FileTransferMethod.LOCAL_FILE and file.upload_file_id
            ]
            uploads = (
                session.scalars(
                    select(UploadFile).where(UploadFile.id.in_(upload_ids), UploadFile.tenant_id == identity.tenant_id)
                )
                if upload_ids
                else ()
            )
            return files, {upload.id: upload for upload in uploads}

    def agent_thought(self, identity: MessageIdentity, thought_id: str) -> MessageAgentThought | None:
        with self._sessions() as session:
            return session.scalar(
                select(MessageAgentThought)
                .join(Message, Message.id == MessageAgentThought.message_id)
                .join(App, App.id == Message.app_id)
                .where(
                    App.tenant_id == identity.tenant_id,
                    App.id == identity.app_id,
                    Message.conversation_id == identity.conversation_id,
                    Message.id == identity.message_id,
                    MessageAgentThought.id == thought_id,
                )
            )

    @staticmethod
    def _apply_usage(message: Message, usage: LLMUsage) -> None:
        message.message_tokens = usage.prompt_tokens
        message.message_unit_price = usage.prompt_unit_price
        message.message_price_unit = usage.prompt_price_unit
        message.answer_tokens = usage.completion_tokens
        message.answer_unit_price = usage.completion_unit_price
        message.answer_price_unit = usage.completion_price_unit
        message.total_price = usage.total_price
        message.currency = usage.currency

    def save_usage(self, identity: MessageIdentity, usage: LLMUsage) -> None:
        with self._sessions.begin() as session:
            message = self._message(session, identity)
            self._apply_usage(message, usage)
            if usage.latency > 0:
                message.provider_response_latency = usage.latency
            metadata = self._metadata(message)
            metadata["usage"] = usage.model_dump(mode="json")
            message.message_metadata = json.dumps(metadata, ensure_ascii=False)

    def create_message_files(self, *, tenant_id: str, message_id: str, files: Sequence[Mapping[str, Any]]) -> list[str]:
        with self._sessions.begin() as session:
            message = session.scalar(
                select(Message)
                .join(App, App.id == Message.app_id)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(Message.id == message_id, App.tenant_id == tenant_id, Conversation.app_id == App.id)
            )
            if message is None:
                raise MessageNotExistsError()
            message_files = []
            for fields in files:
                file_fields = dict(fields)
                file_fields["message_id"] = message_id
                message_file = MessageFile(**file_fields)
                session.add(message_file)
                message_files.append(message_file)
            session.flush()
            return [file.id for file in message_files]

    def agent_history(self, identity: MessageIdentity) -> list[AgentHistoryMessage]:
        with self._sessions() as session:
            self._message(session, identity)
            messages = session.scalars(
                select(Message)
                .where(
                    Message.conversation_id == identity.conversation_id,
                    Message.app_id == identity.app_id,
                )
                .order_by(Message.created_at.desc())
            ).all()
            history = []
            for message in reversed(extract_thread_messages(messages)):
                files = list(session.scalars(select(MessageFile).where(MessageFile.message_id == message.id)))
                config = message.app_model_config_with_session(session=session) if files else None
                history.append(
                    AgentHistoryMessage(
                        message=message,
                        thoughts=list(message.agent_thoughts_with_session(session=session)),
                        files=files,
                        model_config=config.to_dict(
                            annotation_reply=load_annotation_reply_config(session, identity.app_id)
                        )
                        if config
                        else None,
                    )
                )
            session.expunge_all()
            return history

    def create_agent_thought(self, identity: MessageIdentity, fields: Mapping[str, Any]) -> str:
        with self._sessions.begin() as session:
            self._message(session, identity)
            thought_fields = dict(fields)
            thought_fields["message_id"] = identity.message_id
            thought = MessageAgentThought(**thought_fields)
            session.add(thought)
            session.flush()
            return thought.id

    def update_agent_thought(
        self, identity: MessageIdentity, thought_id: str, *, values: Mapping[str, Any], deltas: Mapping[str, str]
    ) -> None:
        with self._sessions.begin() as session:
            self._message(session, identity)
            thought = session.scalar(
                select(MessageAgentThought)
                .where(MessageAgentThought.id == thought_id, MessageAgentThought.message_id == identity.message_id)
                .with_for_update()
            )
            if thought is None:
                return
            for key, value in values.items():
                setattr(thought, key, value)
            for key, delta in deltas.items():
                if key == "thought":
                    thought.thought = f"{thought.thought or ''}{delta}"
                elif key == "tool_input":
                    thought.tool_input = f"{thought.tool_input or ''}{delta}"
                elif key == "answer":
                    thought.answer = f"{thought.answer or ''}{delta}"
                else:
                    raise ValueError(f"unsupported agent thought delta field: {key}")

    def delete_agent_thought(self, identity: MessageIdentity, thought_id: str) -> None:
        with self._sessions.begin() as session:
            self._message(session, identity)
            thought = session.scalar(
                select(MessageAgentThought).where(
                    MessageAgentThought.id == thought_id, MessageAgentThought.message_id == identity.message_id
                )
            )
            if thought is not None:
                session.delete(thought)

    def fail_message(self, identity: MessageIdentity, error: str) -> None:
        with self._sessions.begin() as session:
            try:
                message = self._message(session, identity)
            except MessageNotExistsError:
                return
            message.status = MessageStatus.ERROR
            message.error = error

    def record_human_input(
        self, identity: MessageIdentity, *, workflow_run_id: str, form_id: str | None, node_id: str | None
    ) -> None:
        if form_id is None:
            if node_id is None:
                return
            form = HumanInputFormRepositoryImpl(
                tenant_id=identity.tenant_id,
                app_id=identity.app_id,
                workflow_execution_id=workflow_run_id,
                sessions=self._sessions,
            ).get_form(node_id)
            if form is None:
                return
            form_id = form.id
        with self._sessions.begin() as session:
            self._message(session, identity)
            form_record = session.get(HumanInputForm, form_id)
            if form_record is None or (form_record.tenant_id, form_record.app_id, form_record.workflow_run_id) != (
                identity.tenant_id,
                identity.app_id,
                workflow_run_id,
            ):
                raise MessageNotExistsError("Message human input form not found")
            exists = session.scalar(
                select(HumanInputContent.id).where(
                    HumanInputContent.workflow_run_id == workflow_run_id,
                    HumanInputContent.message_id == identity.message_id,
                    HumanInputContent.form_id == form_id,
                )
            )
            if exists is None:
                session.add(
                    HumanInputContent(
                        workflow_run_id=workflow_run_id,
                        message_id=identity.message_id,
                        form_id=form_id,
                    )
                )

    def annotation_reply(
        self, *, tenant_id: str, app_id: str, annotation_id: str
    ) -> tuple[MessageAnnotation, str | None] | None:
        with self._sessions() as session:
            row = session.execute(
                select(MessageAnnotation, Account.name)
                .join(App, App.id == MessageAnnotation.app_id)
                .outerjoin(Account, Account.id == MessageAnnotation.account_id)
                .where(MessageAnnotation.id == annotation_id, App.id == app_id, App.tenant_id == tenant_id)
            ).one_or_none()
            return (row[0], row[1]) if row is not None else None

    def has_assistant_files(self, *, tenant_id: str, app_id: str, message_id: str) -> bool:
        with self._sessions() as session:
            return (
                session.scalar(
                    select(MessageFile.id)
                    .join(Message, Message.id == MessageFile.message_id)
                    .join(App, App.id == Message.app_id)
                    .where(
                        App.tenant_id == tenant_id,
                        Message.app_id == app_id,
                        Message.id == message_id,
                        MessageFile.belongs_to == MessageFileBelongsTo.ASSISTANT,
                    )
                    .limit(1)
                )
                is not None
            )

    def message_file(self, *, tenant_id: str, app_id: str, file_id: str) -> MessageFile | None:
        with self._sessions() as session:
            return session.scalar(
                select(MessageFile)
                .join(Message, Message.id == MessageFile.message_id)
                .join(App, App.id == Message.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    Message.app_id == app_id,
                    MessageFile.id == file_id,
                )
            )

    def conversation_snapshot(
        self, *, tenant_id: str, app_id: str, conversation_id: str
    ) -> ConversationSnapshot | None:
        with self._sessions() as session:
            conversation = session.scalar(
                select(Conversation)
                .join(App, App.id == Conversation.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    Conversation.app_id == app_id,
                    Conversation.id == conversation_id,
                    Conversation.is_deleted.is_(False),
                )
            )
            return ConversationSnapshot.from_conversation(conversation) if conversation is not None else None

    def rename_conversation(self, *, tenant_id: str, app_id: str, conversation_id: str, name: str) -> None:
        with self._sessions.begin() as session:
            conversation = session.scalar(
                select(Conversation)
                .join(App, App.id == Conversation.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    Conversation.app_id == app_id,
                    Conversation.id == conversation_id,
                    Conversation.is_deleted.is_(False),
                )
                .with_for_update(of=Conversation)
            )
            if conversation is not None:
                conversation.name = name
