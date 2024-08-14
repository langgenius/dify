from threading import Thread
from typing import Optional, Union

from flask import Flask, current_app

from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueMessageFileEvent,
    QueueRetrieverResourcesEvent,
)
from core.app.entities.task_entities import (
    AdvancedChatTaskState,
    EasyUITaskState,
    MessageFileStreamResponse,
    MessageReplaceStreamResponse,
    MessageStreamResponse,
)
from core.llm_generator.llm_generator import LLMGenerator
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_database import db
from models.model import AppMode, Conversation, MessageAnnotation, MessageFile
from services.annotation_service import AppAnnotationService


class MessageCycleManage:
    _application_generate_entity: Union[
        ChatAppGenerateEntity,
        CompletionAppGenerateEntity,
        AgentChatAppGenerateEntity,
        AdvancedChatAppGenerateEntity
    ]
    _task_state: Union[EasyUITaskState, AdvancedChatTaskState]

    def _generate_conversation_name(self, conversation: Conversation, query: str) -> Optional[Thread]:
        """
        Generate conversation name.
        :param conversation: conversation
        :param query: query
        :return: thread
        """
        is_first_message = self._application_generate_entity.conversation_id is None
        extras = self._application_generate_entity.extras
        auto_generate_conversation_name = extras.get('auto_generate_conversation_name', True)

        if auto_generate_conversation_name and is_first_message:
            # start generate thread
            thread = Thread(target=self._generate_conversation_name_worker, kwargs={
                'flask_app': current_app._get_current_object(),
                'conversation_id': conversation.id,
                'query': query
            })

            thread.start()

            return thread

        return None

    def _generate_conversation_name_worker(self,
                                           flask_app: Flask,
                                           conversation_id: str,
                                           query: str):
        with flask_app.app_context():
            # get conversation and message
            conversation = (
                db.session.query(Conversation)
                .filter(Conversation.id == conversation_id)
                .first()
            )

            if conversation.mode != AppMode.COMPLETION.value:
                app_model = conversation.app
                if not app_model:
                    return

                # generate conversation name
                try:
                    name = LLMGenerator.generate_conversation_name(app_model.tenant_id, query)
                    conversation.name = name
                except:
                    pass

                db.session.merge(conversation)
                db.session.commit()
                db.session.close()

    def _handle_annotation_reply(self, event: QueueAnnotationReplyEvent) -> Optional[MessageAnnotation]:
        """
        Handle annotation reply.
        :param event: event
        :return:
        """
        annotation = AppAnnotationService.get_annotation_by_id(event.message_annotation_id)
        if annotation:
            account = annotation.account
            self._task_state.metadata['annotation_reply'] = {
                'id': annotation.id,
                'account': {
                    'id': annotation.account_id,
                    'name': account.name if account else 'Dify user'
                }
            }

            return annotation

        return None

    def _handle_retriever_resources(self, event: QueueRetrieverResourcesEvent) -> None:
        """
        Handle retriever resources.
        :param event: event
        :return:
        """
        if self._application_generate_entity.app_config.additional_features.show_retrieve_source:
            self._task_state.metadata['retriever_resources'] = event.retriever_resources

    def _get_response_metadata(self) -> dict:
        """
        Get response metadata by invoke from.
        :return:
        """
        metadata = {}

        # show_retrieve_source
        if 'retriever_resources' in self._task_state.metadata:
            metadata['retriever_resources'] = self._task_state.metadata['retriever_resources']

        # show annotation reply
        if 'annotation_reply' in self._task_state.metadata:
            metadata['annotation_reply'] = self._task_state.metadata['annotation_reply']

        # show usage
        if self._application_generate_entity.invoke_from in [InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API]:
            metadata['usage'] = self._task_state.metadata['usage']

        return metadata

    def _message_file_to_stream_response(self, event: QueueMessageFileEvent) -> Optional[MessageFileStreamResponse]:
        """
        Message file to stream response.
        :param event: event
        :return:
        """
        message_file: MessageFile = (
            db.session.query(MessageFile)
            .filter(MessageFile.id == event.message_file_id)
            .first()
        )

        if message_file:
            # get tool file id
            tool_file_id = message_file.url.split('/')[-1]
            # trim extension
            tool_file_id = tool_file_id.split('.')[0]

            # get extension
            if '.' in message_file.url:
                extension = f'.{message_file.url.split(".")[-1]}'
                if len(extension) > 10:
                    extension = '.bin'
            else:
                extension = '.bin'
            # add sign url to local file
            if message_file.url.startswith('http'):
                url = message_file.url
            else:
                url = ToolFileManager.sign_file(tool_file_id=tool_file_id, extension=extension)

            return MessageFileStreamResponse(
                task_id=self._application_generate_entity.task_id,
                id=message_file.id,
                type=message_file.type,
                belongs_to=message_file.belongs_to or 'user',
                url=url
            )

        return None

    def _message_to_stream_response(self, answer: str, message_id: str) -> MessageStreamResponse:
        """
        Message to stream response.
        :param answer: answer
        :param message_id: message id
        :return:
        """
        return MessageStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=message_id,
            answer=answer
        )

    def _message_replace_to_stream_response(self, answer: str) -> MessageReplaceStreamResponse:
        """
        Message replace to stream response.
        :param answer: answer
        :return:
        """
        return MessageReplaceStreamResponse(
            task_id=self._application_generate_entity.task_id,
            answer=answer
        )
