import json
import logging
import time
from typing import Generator, Optional, Union, cast

from core.app_runner.moderation_handler import ModerationRule, OutputModerationHandler
from core.application_queue_manager import ApplicationQueueManager, PublishFrom
from core.entities.application_entities import ApplicationGenerateEntity, InvokeFrom
from core.entities.queue_entities import (AnnotationReplyEvent, QueueAgentMessageEvent, QueueAgentThoughtEvent,
                                          QueueErrorEvent, QueueMessageEndEvent, QueueMessageEvent,
                                          QueueMessageFileEvent, QueueMessageReplaceEvent, QueuePingEvent,
                                          QueueRetrieverResourcesEvent, QueueStopEvent)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, ImagePromptMessageContent,
                                                          PromptMessage, PromptMessageContentType, PromptMessageRole,
                                                          TextPromptMessageContent)
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.prompt_template import PromptTemplateParser
from core.tools.tool_file_manager import ToolFileManager
from core.tools.tool_manager import ToolManager
from events.message_event import message_was_created
from extensions.ext_database import db
from models.model import Conversation, Message, MessageAgentThought, MessageFile
from pydantic import BaseModel
from services.annotation_service import AppAnnotationService

logger = logging.getLogger(__name__)


class TaskState(BaseModel):
    """
    TaskState entity
    """
    llm_result: LLMResult
    metadata: dict = {}


class GenerateTaskPipeline:
    """
    GenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    def __init__(self, application_generate_entity: ApplicationGenerateEntity,
                 queue_manager: ApplicationQueueManager,
                 conversation: Conversation,
                 message: Message) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        """
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._conversation = conversation
        self._message = message
        self._task_state = TaskState(
            llm_result=LLMResult(
                model=self._application_generate_entity.app_orchestration_config_entity.model_config.model,
                prompt_messages=[],
                message=AssistantPromptMessage(content=""),
                usage=LLMUsage.empty_usage()
            )
        )
        self._start_at = time.perf_counter()
        self._output_moderation_handler = self._init_output_moderation()

    def process(self, stream: bool) -> Union[dict, Generator]:
        """
        Process generate task pipeline.
        :return:
        """
        if stream:
            return self._process_stream_response()
        else:
            return self._process_blocking_response()

    def _process_blocking_response(self) -> dict:
        """
        Process blocking response.
        :return:
        """
        for queue_message in self._queue_manager.listen():
            event = queue_message.event

            if isinstance(event, QueueErrorEvent):
                raise self._handle_error(event)
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._task_state.metadata['retriever_resources'] = event.retriever_resources
            elif isinstance(event, AnnotationReplyEvent):
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

                    self._task_state.llm_result.message.content = annotation.content
            elif isinstance(event, (QueueStopEvent, QueueMessageEndEvent)):
                if isinstance(event, QueueMessageEndEvent):
                    self._task_state.llm_result = event.llm_result
                else:
                    model_config = self._application_generate_entity.app_orchestration_config_entity.model_config
                    model = model_config.model
                    model_type_instance = model_config.provider_model_bundle.model_type_instance
                    model_type_instance = cast(LargeLanguageModel, model_type_instance)

                    # calculate num tokens
                    prompt_tokens = 0
                    if event.stopped_by != QueueStopEvent.StopBy.ANNOTATION_REPLY:
                        prompt_tokens = model_type_instance.get_num_tokens(
                            model,
                            model_config.credentials,
                            self._task_state.llm_result.prompt_messages
                        )

                    completion_tokens = 0
                    if event.stopped_by == QueueStopEvent.StopBy.USER_MANUAL:
                        completion_tokens = model_type_instance.get_num_tokens(
                            model,
                            model_config.credentials,
                            [self._task_state.llm_result.message]
                        )

                    credentials = model_config.credentials

                    # transform usage
                    self._task_state.llm_result.usage = model_type_instance._calc_response_usage(
                        model,
                        credentials,
                        prompt_tokens,
                        completion_tokens
                    )

                self._task_state.metadata['usage'] = jsonable_encoder(self._task_state.llm_result.usage)

                # response moderation
                if self._output_moderation_handler:
                    self._output_moderation_handler.stop_thread()

                    self._task_state.llm_result.message.content = self._output_moderation_handler.moderation_completion(
                        completion=self._task_state.llm_result.message.content,
                        public_event=False
                    )

                # Save message
                self._save_message(self._task_state.llm_result)

                response = {
                    'event': 'message',
                    'task_id': self._application_generate_entity.task_id,
                    'id': self._message.id,
                    'message_id': self._message.id,
                    'mode': self._conversation.mode,
                    'answer': event.llm_result.message.content,
                    'metadata': {},
                    'created_at': int(self._message.created_at.timestamp())
                }

                if self._conversation.mode == 'chat':
                    response['conversation_id'] = self._conversation.id

                if self._task_state.metadata:
                    response['metadata'] = self._get_response_metadata()

                return response
            else:
                continue

    def _process_stream_response(self) -> Generator:
        """
        Process stream response.
        :return:
        """
        for message in self._queue_manager.listen():
            event = message.event

            if isinstance(event, QueueErrorEvent):
                data = self._error_to_stream_response_data(self._handle_error(event))
                yield self._yield_response(data)
                break
            elif isinstance(event, (QueueStopEvent, QueueMessageEndEvent)):
                if isinstance(event, QueueMessageEndEvent):
                    self._task_state.llm_result = event.llm_result
                else:
                    model_config = self._application_generate_entity.app_orchestration_config_entity.model_config
                    model = model_config.model
                    model_type_instance = model_config.provider_model_bundle.model_type_instance
                    model_type_instance = cast(LargeLanguageModel, model_type_instance)

                    # calculate num tokens
                    prompt_tokens = 0
                    if event.stopped_by != QueueStopEvent.StopBy.ANNOTATION_REPLY:
                        prompt_tokens = model_type_instance.get_num_tokens(
                            model,
                            model_config.credentials,
                            self._task_state.llm_result.prompt_messages
                        )

                    completion_tokens = 0
                    if event.stopped_by == QueueStopEvent.StopBy.USER_MANUAL:
                        completion_tokens = model_type_instance.get_num_tokens(
                            model,
                            model_config.credentials,
                            [self._task_state.llm_result.message]
                        )

                    credentials = model_config.credentials

                    # transform usage
                    self._task_state.llm_result.usage = model_type_instance._calc_response_usage(
                        model,
                        credentials,
                        prompt_tokens,
                        completion_tokens
                    )

                self._task_state.metadata['usage'] = jsonable_encoder(self._task_state.llm_result.usage)

                # response moderation
                if self._output_moderation_handler:
                    self._output_moderation_handler.stop_thread()

                    self._task_state.llm_result.message.content = self._output_moderation_handler.moderation_completion(
                        completion=self._task_state.llm_result.message.content,
                        public_event=False
                    )

                    self._output_moderation_handler = None

                    replace_response = {
                        'event': 'message_replace',
                        'task_id': self._application_generate_entity.task_id,
                        'message_id': self._message.id,
                        'answer': self._task_state.llm_result.message.content,
                        'created_at': int(self._message.created_at.timestamp())
                    }

                    if self._conversation.mode == 'chat':
                        replace_response['conversation_id'] = self._conversation.id

                    yield self._yield_response(replace_response)

                # Save message
                self._save_message(self._task_state.llm_result)

                response = {
                    'event': 'message_end',
                    'task_id': self._application_generate_entity.task_id,
                    'id': self._message.id,
                    'message_id': self._message.id,
                }

                if self._conversation.mode == 'chat':
                    response['conversation_id'] = self._conversation.id

                if self._task_state.metadata:
                    response['metadata'] = self._get_response_metadata()

                yield self._yield_response(response)
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._task_state.metadata['retriever_resources'] = event.retriever_resources
            elif isinstance(event, AnnotationReplyEvent):
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

                    self._task_state.llm_result.message.content = annotation.content
            elif isinstance(event, QueueAgentThoughtEvent):
                agent_thought: MessageAgentThought = (
                    db.session.query(MessageAgentThought)
                    .filter(MessageAgentThought.id == event.agent_thought_id)
                    .first()
                )
                db.session.refresh(agent_thought)

                if agent_thought:
                    response = {
                        'event': 'agent_thought',
                        'id': agent_thought.id,
                        'task_id': self._application_generate_entity.task_id,
                        'message_id': self._message.id,
                        'position': agent_thought.position,
                        'thought': agent_thought.thought,
                        'observation': agent_thought.observation,
                        'tool': agent_thought.tool,
                        'tool_labels': agent_thought.tool_labels,
                        'tool_input': agent_thought.tool_input,
                        'created_at': int(self._message.created_at.timestamp()),
                        'message_files': agent_thought.files
                    }

                    if self._conversation.mode == 'chat':
                        response['conversation_id'] = self._conversation.id

                    yield self._yield_response(response)
            elif isinstance(event, QueueMessageFileEvent):
                message_file: MessageFile = (
                    db.session.query(MessageFile)
                    .filter(MessageFile.id == event.message_file_id)
                    .first()
                )
                # get extension
                if '.' in message_file.url:
                    extension = f'.{message_file.url.split(".")[-1]}'
                    if len(extension) > 10:
                        extension = '.bin'
                else:
                    extension = '.bin'
                # add sign url
                url = ToolFileManager.sign_file(file_id=message_file.id, extension=extension)

                if message_file:
                    response = {
                        'event': 'message_file',
                        'id': message_file.id,
                        'type': message_file.type,
                        'belongs_to': message_file.belongs_to or 'user',
                        'url': url
                    }

                    if self._conversation.mode == 'chat':
                        response['conversation_id'] = self._conversation.id

                    yield self._yield_response(response)

            elif isinstance(event, (QueueMessageEvent, QueueAgentMessageEvent)):
                chunk = event.chunk
                delta_text = chunk.delta.message.content
                if delta_text is None:
                    continue

                if not self._task_state.llm_result.prompt_messages:
                    self._task_state.llm_result.prompt_messages = chunk.prompt_messages

                if self._output_moderation_handler:
                    if self._output_moderation_handler.should_direct_output():
                        # stop subscribe new token when output moderation should direct output
                        self._task_state.llm_result.message.content = self._output_moderation_handler.get_final_output()
                        self._queue_manager.publish_chunk_message(LLMResultChunk(
                            model=self._task_state.llm_result.model,
                            prompt_messages=self._task_state.llm_result.prompt_messages,
                            delta=LLMResultChunkDelta(
                                index=0,
                                message=AssistantPromptMessage(content=self._task_state.llm_result.message.content)
                            )
                        ), PublishFrom.TASK_PIPELINE)
                        self._queue_manager.publish(
                            QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION),
                            PublishFrom.TASK_PIPELINE
                        )
                        continue
                    else:
                        self._output_moderation_handler.append_new_token(delta_text)

                self._task_state.llm_result.message.content += delta_text
                response = self._handle_chunk(delta_text, agent=isinstance(event, QueueAgentMessageEvent))
                yield self._yield_response(response)
            elif isinstance(event, QueueMessageReplaceEvent):
                response = {
                    'event': 'message_replace',
                    'task_id': self._application_generate_entity.task_id,
                    'message_id': self._message.id,
                    'answer': event.text,
                    'created_at': int(self._message.created_at.timestamp())
                }

                if self._conversation.mode == 'chat':
                    response['conversation_id'] = self._conversation.id

                yield self._yield_response(response)
            elif isinstance(event, QueuePingEvent):
                yield "event: ping\n\n"
            else:
                continue

    def _save_message(self, llm_result: LLMResult) -> None:
        """
        Save message.
        :param llm_result: llm result
        :return:
        """
        usage = llm_result.usage

        self._message = db.session.query(Message).filter(Message.id == self._message.id).first()

        self._message.message = self._prompt_messages_to_prompt_for_saving(self._task_state.llm_result.prompt_messages)
        self._message.message_tokens = usage.prompt_tokens
        self._message.message_unit_price = usage.prompt_unit_price
        self._message.message_price_unit = usage.prompt_price_unit
        self._message.answer = PromptTemplateParser.remove_template_variables(llm_result.message.content.strip()) \
            if llm_result.message.content else ''
        self._message.answer_tokens = usage.completion_tokens
        self._message.answer_unit_price = usage.completion_unit_price
        self._message.answer_price_unit = usage.completion_price_unit
        self._message.provider_response_latency = time.perf_counter() - self._start_at
        self._message.total_price = usage.total_price

        db.session.commit()

        message_was_created.send(
            self._message,
            application_generate_entity=self._application_generate_entity,
            conversation=self._conversation,
            is_first_message=self._application_generate_entity.conversation_id is None,
            extras=self._application_generate_entity.extras
        )

    def _handle_chunk(self, text: str, agent: bool = False) -> dict:
        """
        Handle completed event.
        :param text: text
        :return:
        """
        response = {
            'event': 'message' if not agent else 'agent_message',
            'id': self._message.id,
            'task_id': self._application_generate_entity.task_id,
            'message_id': self._message.id,
            'answer': text,
            'created_at': int(self._message.created_at.timestamp())
        }

        if self._conversation.mode == 'chat':
            response['conversation_id'] = self._conversation.id

        return response

    def _handle_error(self, event: QueueErrorEvent) -> Exception:
        """
        Handle error event.
        :param event: event
        :return:
        """
        logger.debug("error: %s", event.error)
        e = event.error

        if isinstance(e, InvokeAuthorizationError):
            return InvokeAuthorizationError('Incorrect API key provided')
        elif isinstance(e, InvokeError) or isinstance(e, ValueError):
            return e
        else:
            return Exception(e.description if getattr(e, 'description', None) is not None else str(e))

    def _error_to_stream_response_data(self, e: Exception) -> dict:
        """
        Error to stream response.
        :param e: exception
        :return:
        """
        error_responses = {
            ValueError: {'code': 'invalid_param', 'status': 400},
            ProviderTokenNotInitError: {'code': 'provider_not_initialize', 'status': 400},
            QuotaExceededError: {
                'code': 'provider_quota_exceeded',
                'message': "Your quota for Dify Hosted Model Provider has been exhausted. "
                       "Please go to Settings -> Model Provider to complete your own provider credentials.",
                'status': 400
            },
            ModelCurrentlyNotSupportError: {'code': 'model_currently_not_support', 'status': 400},
            InvokeError: {'code': 'completion_request_error', 'status': 400}
        }

        # Determine the response based on the type of exception
        data = error_responses.get(type(e))
        if data:
            data.setdefault('message', getattr(e, 'description', str(e)))
        else:
            logging.error(e)
            data = {
                'code': 'internal_server_error', 
                'message': 'Internal Server Error, please contact support.',
                'status': 500
                }

        return {
            'event': 'error',
            'task_id': self._application_generate_entity.task_id,
            'message_id': self._message.id,
            **data
        }

    def _get_response_metadata(self) -> dict:
        """
        Get response metadata by invoke from.
        :return:
        """
        metadata = {}

        # show_retrieve_source
        if 'retriever_resources' in self._task_state.metadata:
            if self._application_generate_entity.invoke_from in [InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API]:
                metadata['retriever_resources'] = self._task_state.metadata['retriever_resources']
            else:
                metadata['retriever_resources'] = []
                for resource in self._task_state.metadata['retriever_resources']:
                    metadata['retriever_resources'].append({
                        'segment_id': resource['segment_id'],
                        'position': resource['position'],
                        'document_name': resource['document_name'],
                        'score': resource['score'],
                        'content': resource['content'],
                    })
        # show annotation reply
        if 'annotation_reply' in self._task_state.metadata:
            if self._application_generate_entity.invoke_from in [InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API]:
                metadata['annotation_reply'] = self._task_state.metadata['annotation_reply']

        # show usage
        if self._application_generate_entity.invoke_from in [InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API]:
            metadata['usage'] = self._task_state.metadata['usage']

        return metadata

    def _yield_response(self, response: dict) -> str:
        """
        Yield response.
        :param response: response
        :return:
        """
        return "data: " + json.dumps(response) + "\n\n"

    def _prompt_messages_to_prompt_for_saving(self, prompt_messages: list[PromptMessage]) -> list[dict]:
        """
        Prompt messages to prompt for saving.
        :param prompt_messages: prompt messages
        :return:
        """
        prompts = []
        if self._application_generate_entity.app_orchestration_config_entity.model_config.mode == 'chat':
            for prompt_message in prompt_messages:
                if prompt_message.role == PromptMessageRole.USER:
                    role = 'user'
                elif prompt_message.role == PromptMessageRole.ASSISTANT:
                    role = 'assistant'
                elif prompt_message.role == PromptMessageRole.SYSTEM:
                    role = 'system'
                else:
                    continue

                text = ''
                files = []
                if isinstance(prompt_message.content, list):
                    for content in prompt_message.content:
                        if content.type == PromptMessageContentType.TEXT:
                            content = cast(TextPromptMessageContent, content)
                            text += content.data
                        else:
                            content = cast(ImagePromptMessageContent, content)
                            files.append({
                                "type": 'image',
                                "data": content.data[:10] + '...[TRUNCATED]...' + content.data[-10:],
                                "detail": content.detail.value
                            })
                else:
                    text = prompt_message.content

                prompts.append({
                    "role": role,
                    "text": text,
                    "files": files
                })
        else:
            prompt_message = prompt_messages[0]
            text = ''
            files = []
            if isinstance(prompt_message.content, list):
                for content in prompt_message.content:
                    if content.type == PromptMessageContentType.TEXT:
                        content = cast(TextPromptMessageContent, content)
                        text += content.data
                    else:
                        content = cast(ImagePromptMessageContent, content)
                        files.append({
                            "type": 'image',
                            "data": content.data[:10] + '...[TRUNCATED]...' + content.data[-10:],
                            "detail": content.detail.value
                        })
            else:
                text = prompt_message.content

            params = {
                "role": 'user',
                "text": text,
            }

            if files:
                params['files'] = files

            prompts.append(params)

        return prompts

    def _init_output_moderation(self) -> Optional[OutputModerationHandler]:
        """
        Init output moderation.
        :return:
        """
        app_orchestration_config_entity = self._application_generate_entity.app_orchestration_config_entity
        sensitive_word_avoidance = app_orchestration_config_entity.sensitive_word_avoidance

        if sensitive_word_avoidance:
            return OutputModerationHandler(
                tenant_id=self._application_generate_entity.tenant_id,
                app_id=self._application_generate_entity.app_id,
                rule=ModerationRule(
                    type=sensitive_word_avoidance.type,
                    config=sensitive_word_avoidance.config
                ),
                on_message_replace_func=self._queue_manager.publish_message_replace
            )
