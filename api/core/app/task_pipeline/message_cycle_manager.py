import logging
from threading import Thread
from typing import Union

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
from core.llm_generator.llm_generator import LLMGenerator
from core.tools.signature import sign_tool_file
from extensions.ext_database import db
from models.model import AppMode, Conversation, MessageAnnotation, MessageFile
from services.annotation_service import AppAnnotationService

logger = logging.getLogger(__name__)


class MessageCycleManager:
    def __init__(
        self,
        *,
        application_generate_entity: Union[
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
            AgentChatAppGenerateEntity,
            AdvancedChatAppGenerateEntity,
        ],
        task_state: Union[EasyUITaskState, WorkflowTaskState],
    ):
        self._application_generate_entity = application_generate_entity
        self._task_state = task_state

    def generate_conversation_name(self, *, conversation_id: str, query: str) -> Thread | None:
        """
        Generate conversation name.
        :param conversation_id: conversation id
        :param query: query
        :return: thread
        """
        if isinstance(self._application_generate_entity, CompletionAppGenerateEntity):
            return None

        is_first_message = self._application_generate_entity.conversation_id is None
        extras = self._application_generate_entity.extras
        auto_generate_conversation_name = extras.get("auto_generate_conversation_name", True)

        if auto_generate_conversation_name and is_first_message:
            # start generate thread
            thread = Thread(
                target=self._generate_conversation_name_worker,
                kwargs={
                    "flask_app": current_app._get_current_object(),  # type: ignore
                    "conversation_id": conversation_id,
                    "query": query,
                },
            )

            thread.start()

            return thread

        return None

    def _generate_conversation_name_worker(self, flask_app: Flask, conversation_id: str, query: str):
        with flask_app.app_context():
            # get conversation and message
            stmt = select(Conversation).where(Conversation.id == conversation_id)
            conversation = db.session.scalar(stmt)

            if not conversation:
                return

            if conversation.mode != AppMode.COMPLETION:
                app_model = conversation.app
                if not app_model:
                    return

                # generate conversation name
                try:
                    name = LLMGenerator.generate_conversation_name(
                        app_model.tenant_id, query, conversation_id, conversation.app_id
                    )
                    conversation.name = name
                except Exception:
                    if dify_config.DEBUG:
                        logger.exception("generate conversation name failed, conversation_id: %s", conversation_id)

                db.session.commit()
                db.session.close()

    def handle_annotation_reply(self, event: QueueAnnotationReplyEvent) -> MessageAnnotation | None:
        """
        Handle annotation reply.
        :param event: event
        :return:
        """
        annotation = AppAnnotationService.get_annotation_by_id(event.message_annotation_id)
        if annotation:
            account = annotation.account
            self._task_state.metadata.annotation_reply = AnnotationReply(
                id=annotation.id,
                account=AnnotationReplyAccount(
                    id=annotation.account_id,
                    name=account.name if account else "Dify user",
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

            # Add new unique resources from the event
            for resource in event.retriever_resources or []:
                if not resource:
                    continue

                is_duplicate = (
                    resource.dataset_id
                    and resource.document_id
                    and (resource.dataset_id, resource.document_id) in existing_ids
                )

                if not is_duplicate:
                    merged_resources.append(resource)

            for i, resource in enumerate(merged_resources, 1):
                resource.position = i

            self._task_state.metadata.retriever_resources = merged_resources

    def message_file_to_stream_response(self, event: QueueMessageFileEvent) -> MessageFileStreamResponse | None:
        """
        Message file to stream response.
        :param event: event
        :return:
        """
        with Session(db.engine, expire_on_commit=False) as session:
            message_file = session.scalar(select(MessageFile).where(MessageFile.id == event.message_file_id))

        if message_file and message_file.url is not None:
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

            return MessageFileStreamResponse(
                task_id=self._application_generate_entity.task_id,
                id=message_file.id,
                type=message_file.type,
                belongs_to=message_file.belongs_to or "user",
                url=url,
            )

        return None

    def message_to_stream_response(
        self, answer: str, message_id: str, from_variable_selector: list[str] | None = None
    ) -> MessageStreamResponse:
        """
        Message to stream response.
        :param answer: answer
        :param message_id: message id
        :return:
        """
        with Session(db.engine, expire_on_commit=False) as session:
            message_file = session.scalar(select(MessageFile).where(MessageFile.id == message_id))
        event_type = StreamEvent.MESSAGE_FILE if message_file else StreamEvent.MESSAGE

        return MessageStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=message_id,
            answer=answer,
            from_variable_selector=from_variable_selector,
            event=event_type,
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
