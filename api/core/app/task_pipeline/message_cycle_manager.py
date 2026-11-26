import hashlib
import logging
import os
from threading import Thread, Timer
from uuid import UUID

from flask import Flask, current_app
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueMessageFileEvent,
    QueueRetrieverResourcesEvent,
)
from core.app.entities.task_entities import (
    AnnotationReply,
    AnnotationReplyAccount,
    EasyUITaskState,
    MessageFileStreamResponse,
    MessageReplaceStreamResponse,
    MessageStreamResponse,
    StreamEvent,
    WorkflowTaskState,
)
from core.db.session_factory import session_factory
from core.llm_generator.llm_generator import LLMGenerator
from core.tools.signature import sign_tool_file
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from graphon.file import FileTransferMethod
from models.enums import MessageFileBelongsTo
from models.model import App, AppMode, Conversation, MessageAnnotation, MessageFile, UploadFile
from models.tools import ToolFile
from services.annotation_service import AppAnnotationService

logger = logging.getLogger(__name__)


def _parse_uuid(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _normalize_basename(name: str | None) -> str | None:
    basename = os.path.basename((name or "").replace("\\", "/")).strip()
    if basename in {"", ".", ".."}:
        return None
    return basename


class MessageCycleManager:
    def __init__(
        self,
        *,
        application_generate_entity: ChatAppGenerateEntity
        | CompletionAppGenerateEntity
        | AgentChatAppGenerateEntity
        | AdvancedChatAppGenerateEntity,
        task_state: EasyUITaskState | WorkflowTaskState,
    ):
        self._application_generate_entity = application_generate_entity
        self._task_state = task_state
        self._message_has_file: set[str] = set()

    def get_message_event_type(self, message_id: str) -> StreamEvent:
        # Fast path: cached determination from prior QueueMessageFileEvent
        if message_id in self._message_has_file:
            return StreamEvent.MESSAGE_FILE

        # Use SQLAlchemy 2.x style session.scalar(select(...))
        with session_factory.create_session() as session:
            message_file = session.scalar(
                select(MessageFile).where(MessageFile.message_id == message_id, MessageFile.belongs_to == "assistant")
            )

        if message_file:
            self._message_has_file.add(message_id)
            return StreamEvent.MESSAGE_FILE

        return StreamEvent.MESSAGE

    def generate_conversation_name(
        self, *, conversation_id: str, query: str, message_id: str | None = None
    ) -> Thread | None:
        """
        Generate conversation name.
        :param conversation_id: conversation id
        :param query: query
        :return: thread
        """
        if isinstance(self._application_generate_entity, CompletionAppGenerateEntity):
            return None

        is_first_message = self._application_generate_entity.is_new_conversation
        extras = self._application_generate_entity.extras
        auto_generate_conversation_name = extras.get("auto_generate_conversation_name", True)

        thread: Thread | None = None
        if auto_generate_conversation_name and is_first_message:
            # start generate thread
            # time.sleep not block other logic
            thread = Timer(
                1,
                self._generate_conversation_name_worker,
                kwargs={
                    "flask_app": current_app._get_current_object(),  # type: ignore
                    "conversation_id": conversation_id,
                    "query": query,
                    "message_id": message_id,
                },
            )
            thread.daemon = True
            thread.start()

        if is_first_message:
            self._application_generate_entity.is_new_conversation = False

        return thread

    def _generate_conversation_name_worker(
        self,
        flask_app: Flask,
        conversation_id: str,
        query: str,
        message_id: str | None = None,
    ):
        with flask_app.app_context():
            with session_factory.create_session() as session:
                # get conversation and message
                stmt = select(Conversation).where(Conversation.id == conversation_id)
                conversation = session.scalar(stmt)

                if not conversation:
                    return

                if conversation.mode != AppMode.COMPLETION:
                    app_model = session.get(App, conversation.app_id)
                    if not app_model:
                        return

                    # generate conversation name
                    query_hash = hashlib.md5(query.encode()).hexdigest()[:16]
                    cache_key = f"conv_name:{conversation_id}:{query_hash}"

                    cached_name = redis_client.get(cache_key)
                    if cached_name:
                        name = cached_name.decode("utf-8")
                    else:
                        try:
                            name = LLMGenerator.generate_conversation_name(
                                app_model.tenant_id,
                                query,
                                conversation_id,
                                conversation.app_id,
                                message_id=message_id,
                                # The request's scope keeps the caller's trace ID with the message.
                                trace_scope=self._application_generate_entity.trace_scope,
                            )
                            redis_client.setex(cache_key, 3600, name)
                        except Exception:
                            if dify_config.DEBUG:
                                logger.exception(
                                    "generate conversation name failed, conversation_id: %s", conversation_id
                                )
                            name = query[:47] + "..." if len(query) > 50 else query
                    conversation.name = name
                    session.commit()

    def handle_annotation_reply(self, event: QueueAnnotationReplyEvent, session: Session) -> MessageAnnotation | None:
        """
        Handle annotation reply.
        :param event: event
        :return:
        """
        reply = AppAnnotationService.get_annotation_reply_by_id(event.message_annotation_id, session)
        if reply:
            annotation, account_name = reply
            self._task_state.metadata.annotation_reply = AnnotationReply(
                id=annotation.id,
                account=AnnotationReplyAccount(
                    id=annotation.account_id,
                    name=account_name if account_name is not None else "Dify user",
                ),
            )

            return annotation

        return None

    def handle_retriever_resources(self, event: QueueRetrieverResourcesEvent):
        """
        Handle retriever resources.
        :param event: event
        :return:
        """
        if not self._application_generate_entity.app_config.additional_features:
            raise ValueError("Additional features not found")
        if self._application_generate_entity.app_config.additional_features.show_retrieve_source:
            merged_resources = [r for r in self._task_state.metadata.retriever_resources or [] if r]
            existing_ids = {(r.dataset_id, r.document_id) for r in merged_resources if r.dataset_id and r.document_id}
            receipt_ids = {r.knowledge_fs_citation.id for r in merged_resources if r.knowledge_fs_citation}

            # Add new unique resources from the event
            for resource in event.retriever_resources or []:
                if not resource:
                    continue

                is_duplicate = (
                    resource.knowledge_fs_citation.id in receipt_ids
                    if resource.knowledge_fs_citation
                    else (
                        resource.knowledge_fs_citation is None
                        and resource.dataset_id
                        and resource.document_id
                        and (resource.dataset_id, resource.document_id) in existing_ids
                    )
                )

                if not is_duplicate:
                    merged_resources.append(resource)
                    if resource.knowledge_fs_citation:
                        receipt_ids.add(resource.knowledge_fs_citation.id)

            for i, resource in enumerate(merged_resources, 1):
                resource.position = i

            self._task_state.metadata.retriever_resources = merged_resources

    def _resolve_stream_file_metadata(
        self,
        session: Session,
        message_file: MessageFile,
        *,
        tool_file_id: str,
        extension: str,
    ) -> tuple[str | None, str | None, int | None, str | None]:
        """Resolve filename, MIME type, size, and backing file ID for a streamed attachment.

        Enforces fail-closed tenant scoping: metadata lookups run only when `app_config.tenant_id`
        is a non-empty string and the candidate identifier parses as a valid UUID, always filtering
        by `tenant_id`. Returned filenames are normalized to safe basenames, and `size` is emitted
        only when it is a non-negative integer.
        """
        raw_tenant_id = self._application_generate_entity.app_config.tenant_id
        if not isinstance(raw_tenant_id, str) or not raw_tenant_id:
            return None, None, None, message_file.upload_file_id
        tenant_id = raw_tenant_id

        if message_file.transfer_method == FileTransferMethod.TOOL_FILE:
            candidate_id = _parse_uuid(message_file.upload_file_id or tool_file_id)
            if candidate_id is None:
                return None, None, None, message_file.upload_file_id
            tool_file = session.scalar(
                select(ToolFile).where(
                    ToolFile.id == candidate_id,
                    ToolFile.tenant_id == tenant_id,
                )
            )
            if tool_file is None:
                return None, None, None, message_file.upload_file_id
            filename = _normalize_basename(tool_file.name) or f"{tool_file.id}{extension}"
            size = tool_file.size if isinstance(tool_file.size, int) and tool_file.size >= 0 else None
            return filename, tool_file.mimetype or None, size, tool_file.id

        if message_file.upload_file_id:
            candidate_id = _parse_uuid(message_file.upload_file_id)
            if candidate_id is None:
                return None, None, None, message_file.upload_file_id
            upload_file = session.scalar(
                select(UploadFile).where(
                    UploadFile.id == candidate_id,
                    UploadFile.tenant_id == tenant_id,
                )
            )
            if upload_file is None:
                return None, None, None, message_file.upload_file_id
            filename = _normalize_basename(upload_file.name)
            size = upload_file.size if isinstance(upload_file.size, int) and upload_file.size >= 0 else None
            return filename, upload_file.mime_type or None, size, upload_file.id

        return None, None, None, message_file.upload_file_id

    def message_file_to_stream_response(self, event: QueueMessageFileEvent) -> MessageFileStreamResponse | None:
        """
        Message file to stream response.
        :param event: event
        :return:
        """
        with Session(db.engine, expire_on_commit=False) as session:
            message_file = session.scalar(select(MessageFile).where(MessageFile.id == event.message_file_id))
            if not message_file or message_file.url is None:
                return None

            self._message_has_file.add(message_file.message_id)

            # get tool file id
            tool_file_id = message_file.url.split("/")[-1]
            # trim extension
            tool_file_id = tool_file_id.split(".")[0]

            # get extension
            if "." in message_file.url:
                extension = f".{message_file.url.split('.')[-1]}"
                if len(extension) > 10:
                    extension = ".bin"
            else:
                extension = ".bin"
            # add sign url to local file
            if message_file.url.startswith("http"):
                url = message_file.url
            else:
                url = sign_tool_file(tool_file_id=tool_file_id, extension=extension)

            filename, mime_type, size, upload_file_id = self._resolve_stream_file_metadata(
                session,
                message_file,
                tool_file_id=tool_file_id,
                extension=extension,
            )

        return MessageFileStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=message_file.id,
            type=message_file.type,
            belongs_to=message_file.belongs_to or MessageFileBelongsTo.USER,
            url=url,
            filename=filename,
            mime_type=mime_type,
            size=size,
            transfer_method=message_file.transfer_method,
            upload_file_id=upload_file_id,
        )

    def message_to_stream_response(
        self,
        answer: str,
        message_id: str,
        from_variable_selector: list[str] | None = None,
        event_type: StreamEvent | None = None,
    ) -> MessageStreamResponse:
        """
        Message to stream response.
        :param answer: answer
        :param message_id: message id
        :return:
        """
        return MessageStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=message_id,
            answer=answer,
            from_variable_selector=from_variable_selector or [],
            event=event_type or StreamEvent.MESSAGE,
        )

    def message_replace_to_stream_response(self, answer: str, reason: str = "") -> MessageReplaceStreamResponse:
        """
        Message replace to stream response.
        :param answer: answer
        :return:
        """
        return MessageReplaceStreamResponse(
            task_id=self._application_generate_entity.task_id, answer=answer, reason=reason
        )
