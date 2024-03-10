import json
import logging
import time
from collections.abc import Generator
from typing import Optional, Union

from pydantic import BaseModel, Extra

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.workflow_based_generate_task_pipeline import WorkflowBasedGenerateTaskPipeline
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueMessageFileEvent,
    QueueMessageReplaceEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.moderation.output_moderation import ModerationRule, OutputModeration
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeType, SystemVariable
from events.message_event import message_was_created
from extensions.ext_database import db
from models.account import Account
from models.model import Conversation, EndUser, Message, MessageFile
from models.workflow import (
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowRunTriggeredFrom,
)
from services.annotation_service import AppAnnotationService

logger = logging.getLogger(__name__)


class TaskState(BaseModel):
    """
    TaskState entity
    """
    class NodeExecutionInfo(BaseModel):
        """
        NodeExecutionInfo entity
        """
        workflow_node_execution_id: str
        start_at: float

        class Config:
            """Configuration for this pydantic object."""

            extra = Extra.forbid
            arbitrary_types_allowed = True

    answer: str = ""
    metadata: dict = {}
    usage: LLMUsage

    workflow_run_id: Optional[str] = None
    start_at: Optional[float] = None
    total_tokens: int = 0
    total_steps: int = 0

    running_node_execution_infos: dict[str, NodeExecutionInfo] = {}
    latest_node_execution_info: Optional[NodeExecutionInfo] = None

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid
        arbitrary_types_allowed = True


class AdvancedChatAppGenerateTaskPipeline(WorkflowBasedGenerateTaskPipeline):
    """
    AdvancedChatAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    def __init__(self, application_generate_entity: AdvancedChatAppGenerateEntity,
                 workflow: Workflow,
                 queue_manager: AppQueueManager,
                 conversation: Conversation,
                 message: Message,
                 user: Union[Account, EndUser],
                 stream: bool) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param user: user
        :param stream: stream
        """
        self._application_generate_entity = application_generate_entity
        self._workflow = workflow
        self._queue_manager = queue_manager
        self._conversation = conversation
        self._message = message
        self._user = user
        self._task_state = TaskState(
            usage=LLMUsage.empty_usage()
        )
        self._start_at = time.perf_counter()
        self._output_moderation_handler = self._init_output_moderation()
        self._stream = stream

    def process(self) -> Union[dict, Generator]:
        """
        Process generate task pipeline.
        :return:
        """
        db.session.refresh(self._workflow)
        db.session.refresh(self._user)
        db.session.close()

        if self._stream:
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
            elif isinstance(event, QueueAnnotationReplyEvent):
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

                    self._task_state.answer = annotation.content
            elif isinstance(event, QueueWorkflowStartedEvent):
                self._on_workflow_start()
            elif isinstance(event, QueueNodeStartedEvent):
                self._on_node_start(event)
            elif isinstance(event, QueueNodeSucceededEvent | QueueNodeFailedEvent):
                self._on_node_finished(event)
            elif isinstance(event, QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent):
                workflow_run = self._on_workflow_finished(event)

                if workflow_run.status != WorkflowRunStatus.SUCCEEDED.value:
                    raise self._handle_error(QueueErrorEvent(error=ValueError(f'Run failed: {workflow_run.error}')))

                # response moderation
                if self._output_moderation_handler:
                    self._output_moderation_handler.stop_thread()

                    self._task_state.answer = self._output_moderation_handler.moderation_completion(
                        completion=self._task_state.answer,
                        public_event=False
                    )

                # Save message
                self._save_message()

                response = {
                    'event': 'message',
                    'task_id': self._application_generate_entity.task_id,
                    'id': self._message.id,
                    'message_id': self._message.id,
                    'conversation_id': self._conversation.id,
                    'mode': self._conversation.mode,
                    'answer': self._task_state.answer,
                    'metadata': {},
                    'created_at': int(self._message.created_at.timestamp())
                }

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
            elif isinstance(event, QueueWorkflowStartedEvent):
                workflow_run = self._on_workflow_start()

                response = {
                    'event': 'workflow_started',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': workflow_run.id,
                    'data': {
                        'id': workflow_run.id,
                        'workflow_id': workflow_run.workflow_id,
                        'created_at': int(workflow_run.created_at.timestamp())
                    }
                }

                yield self._yield_response(response)
            elif isinstance(event, QueueNodeStartedEvent):
                workflow_node_execution = self._on_node_start(event)

                response = {
                    'event': 'node_started',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': workflow_node_execution.workflow_run_id,
                    'data': {
                        'id': workflow_node_execution.id,
                        'node_id': workflow_node_execution.node_id,
                        'index': workflow_node_execution.index,
                        'predecessor_node_id': workflow_node_execution.predecessor_node_id,
                        'inputs': workflow_node_execution.inputs_dict,
                        'created_at': int(workflow_node_execution.created_at.timestamp())
                    }
                }

                yield self._yield_response(response)
            elif isinstance(event, QueueNodeSucceededEvent | QueueNodeFailedEvent):
                workflow_node_execution = self._on_node_finished(event)

                if workflow_node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED.value:
                    if workflow_node_execution.node_type == NodeType.LLM.value:
                        outputs = workflow_node_execution.outputs_dict
                        usage_dict = outputs.get('usage', {})
                        self._task_state.metadata['usage'] = usage_dict

                response = {
                    'event': 'node_finished',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': workflow_node_execution.workflow_run_id,
                    'data': {
                        'id': workflow_node_execution.id,
                        'node_id': workflow_node_execution.node_id,
                        'index': workflow_node_execution.index,
                        'predecessor_node_id': workflow_node_execution.predecessor_node_id,
                        'inputs': workflow_node_execution.inputs_dict,
                        'process_data': workflow_node_execution.process_data_dict,
                        'outputs': workflow_node_execution.outputs_dict,
                        'status': workflow_node_execution.status,
                        'error': workflow_node_execution.error,
                        'elapsed_time': workflow_node_execution.elapsed_time,
                        'execution_metadata': workflow_node_execution.execution_metadata_dict,
                        'created_at': int(workflow_node_execution.created_at.timestamp()),
                        'finished_at': int(workflow_node_execution.finished_at.timestamp())
                    }
                }

                yield self._yield_response(response)
            elif isinstance(event, QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent):
                workflow_run = self._on_workflow_finished(event)

                if workflow_run.status != WorkflowRunStatus.SUCCEEDED.value:
                    err_event = QueueErrorEvent(error=ValueError(f'Run failed: {workflow_run.error}'))
                    data = self._error_to_stream_response_data(self._handle_error(err_event))
                    yield self._yield_response(data)
                    break

                workflow_run_response = {
                    'event': 'workflow_finished',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': workflow_run.id,
                    'data': {
                        'id': workflow_run.id,
                        'workflow_id': workflow_run.workflow_id,
                        'status': workflow_run.status,
                        'outputs': workflow_run.outputs_dict,
                        'error': workflow_run.error,
                        'elapsed_time': workflow_run.elapsed_time,
                        'total_tokens': workflow_run.total_tokens,
                        'total_steps': workflow_run.total_steps,
                        'created_at': int(workflow_run.created_at.timestamp()),
                        'finished_at': int(workflow_run.finished_at.timestamp())
                    }
                }

                yield self._yield_response(workflow_run_response)

                # response moderation
                if self._output_moderation_handler:
                    self._output_moderation_handler.stop_thread()

                    self._task_state.answer = self._output_moderation_handler.moderation_completion(
                        completion=self._task_state.answer,
                        public_event=False
                    )

                    self._output_moderation_handler = None

                    replace_response = {
                        'event': 'message_replace',
                        'task_id': self._application_generate_entity.task_id,
                        'message_id': self._message.id,
                        'conversation_id': self._conversation.id,
                        'answer': self._task_state.answer,
                        'created_at': int(self._message.created_at.timestamp())
                    }

                    yield self._yield_response(replace_response)

                # Save message
                self._save_message()

                response = {
                    'event': 'message_end',
                    'task_id': self._application_generate_entity.task_id,
                    'id': self._message.id,
                    'message_id': self._message.id,
                    'conversation_id': self._conversation.id,
                }

                if self._task_state.metadata:
                    response['metadata'] = self._get_response_metadata()

                yield self._yield_response(response)
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._task_state.metadata['retriever_resources'] = event.retriever_resources
            elif isinstance(event, QueueAnnotationReplyEvent):
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

                    self._task_state.answer = annotation.content
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
                        'conversation_id': self._conversation.id,
                        'id': message_file.id,
                        'type': message_file.type,
                        'belongs_to': message_file.belongs_to or 'user',
                        'url': url
                    }

                    yield self._yield_response(response)
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                if self._output_moderation_handler:
                    if self._output_moderation_handler.should_direct_output():
                        # stop subscribe new token when output moderation should direct output
                        self._task_state.answer = self._output_moderation_handler.get_final_output()
                        self._queue_manager.publish(
                            QueueTextChunkEvent(
                                text=self._task_state.answer
                            ), PublishFrom.TASK_PIPELINE
                        )

                        self._queue_manager.publish(
                            QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION),
                            PublishFrom.TASK_PIPELINE
                        )
                        continue
                    else:
                        self._output_moderation_handler.append_new_token(delta_text)

                self._task_state.answer += delta_text
                response = self._handle_chunk(delta_text)
                yield self._yield_response(response)
            elif isinstance(event, QueueMessageReplaceEvent):
                response = {
                    'event': 'message_replace',
                    'task_id': self._application_generate_entity.task_id,
                    'message_id': self._message.id,
                    'conversation_id': self._conversation.id,
                    'answer': event.text,
                    'created_at': int(self._message.created_at.timestamp())
                }

                yield self._yield_response(response)
            elif isinstance(event, QueuePingEvent):
                yield "event: ping\n\n"
            else:
                continue

    def _on_workflow_start(self) -> WorkflowRun:
        self._task_state.start_at = time.perf_counter()

        workflow_run = self._init_workflow_run(
            workflow=self._workflow,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING
            if self._application_generate_entity.invoke_from == InvokeFrom.DEBUGGER
            else WorkflowRunTriggeredFrom.APP_RUN,
            user=self._user,
            user_inputs=self._application_generate_entity.inputs,
            system_inputs={
                SystemVariable.QUERY: self._message.query,
                SystemVariable.FILES: self._application_generate_entity.files,
                SystemVariable.CONVERSATION: self._conversation.id,
            }
        )

        self._task_state.workflow_run_id = workflow_run.id

        db.session.close()

        return workflow_run

    def _on_node_start(self, event: QueueNodeStartedEvent) -> WorkflowNodeExecution:
        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == self._task_state.workflow_run_id).first()
        workflow_node_execution = self._init_node_execution_from_workflow_run(
            workflow_run=workflow_run,
            node_id=event.node_id,
            node_type=event.node_type,
            node_title=event.node_data.title,
            node_run_index=event.node_run_index,
            predecessor_node_id=event.predecessor_node_id
        )

        latest_node_execution_info = TaskState.NodeExecutionInfo(
            workflow_node_execution_id=workflow_node_execution.id,
            start_at=time.perf_counter()
        )

        self._task_state.running_node_execution_infos[event.node_id] = latest_node_execution_info
        self._task_state.latest_node_execution_info = latest_node_execution_info

        self._task_state.total_steps += 1

        db.session.close()

        return workflow_node_execution

    def _on_node_finished(self, event: QueueNodeSucceededEvent | QueueNodeFailedEvent) -> WorkflowNodeExecution:
        current_node_execution = self._task_state.running_node_execution_infos[event.node_id]
        workflow_node_execution = db.session.query(WorkflowNodeExecution).filter(
            WorkflowNodeExecution.id == current_node_execution.workflow_node_execution_id).first()
        if isinstance(event, QueueNodeSucceededEvent):
            workflow_node_execution = self._workflow_node_execution_success(
                workflow_node_execution=workflow_node_execution,
                start_at=current_node_execution.start_at,
                inputs=event.inputs,
                process_data=event.process_data,
                outputs=event.outputs,
                execution_metadata=event.execution_metadata
            )

            if event.execution_metadata and event.execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS):
                self._task_state.total_tokens += (
                    int(event.execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS)))

            if workflow_node_execution.node_type == NodeType.LLM.value:
                outputs = workflow_node_execution.outputs_dict
                usage_dict = outputs.get('usage', {})
                self._task_state.metadata['usage'] = usage_dict
        else:
            workflow_node_execution = self._workflow_node_execution_failed(
                workflow_node_execution=workflow_node_execution,
                start_at=current_node_execution.start_at,
                error=event.error
            )

        # remove running node execution info
        del self._task_state.running_node_execution_infos[event.node_id]

        db.session.close()

        return workflow_node_execution

    def _on_workflow_finished(self, event: QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent) \
            -> WorkflowRun:
        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == self._task_state.workflow_run_id).first()
        if isinstance(event, QueueStopEvent):
            workflow_run = self._workflow_run_failed(
                workflow_run=workflow_run,
                start_at=self._task_state.start_at,
                total_tokens=self._task_state.total_tokens,
                total_steps=self._task_state.total_steps,
                status=WorkflowRunStatus.STOPPED,
                error='Workflow stopped.'
            )
        elif isinstance(event, QueueWorkflowFailedEvent):
            workflow_run = self._workflow_run_failed(
                workflow_run=workflow_run,
                start_at=self._task_state.start_at,
                total_tokens=self._task_state.total_tokens,
                total_steps=self._task_state.total_steps,
                status=WorkflowRunStatus.FAILED,
                error=event.error
            )
        else:
            if self._task_state.latest_node_execution_info:
                workflow_node_execution = db.session.query(WorkflowNodeExecution).filter(
                    WorkflowNodeExecution.id == self._task_state.latest_node_execution_info.workflow_node_execution_id).first()
                outputs = workflow_node_execution.outputs
            else:
                outputs = None

            workflow_run = self._workflow_run_success(
                workflow_run=workflow_run,
                start_at=self._task_state.start_at,
                total_tokens=self._task_state.total_tokens,
                total_steps=self._task_state.total_steps,
                outputs=outputs
            )

        self._task_state.workflow_run_id = workflow_run.id

        if workflow_run.status == WorkflowRunStatus.SUCCEEDED.value:
            outputs = workflow_run.outputs_dict
            self._task_state.answer = outputs.get('text', '')

        db.session.close()

        return workflow_run

    def _save_message(self) -> None:
        """
        Save message.
        :return:
        """
        self._message = db.session.query(Message).filter(Message.id == self._message.id).first()

        self._message.answer = self._task_state.answer
        self._message.provider_response_latency = time.perf_counter() - self._start_at
        self._message.workflow_run_id = self._task_state.workflow_run_id

        if self._task_state.metadata and self._task_state.metadata.get('usage'):
            usage = LLMUsage(**self._task_state.metadata['usage'])

            self._message.message_tokens = usage.prompt_tokens
            self._message.message_unit_price = usage.prompt_unit_price
            self._message.message_price_unit = usage.prompt_price_unit
            self._message.answer_tokens = usage.completion_tokens
            self._message.answer_unit_price = usage.completion_unit_price
            self._message.answer_price_unit = usage.completion_price_unit
            self._message.provider_response_latency = time.perf_counter() - self._start_at
            self._message.total_price = usage.total_price
            self._message.currency = usage.currency

        db.session.commit()

        message_was_created.send(
            self._message,
            application_generate_entity=self._application_generate_entity,
            conversation=self._conversation,
            is_first_message=self._application_generate_entity.conversation_id is None,
            extras=self._application_generate_entity.extras
        )

    def _handle_chunk(self, text: str) -> dict:
        """
        Handle completed event.
        :param text: text
        :return:
        """
        response = {
            'event': 'message',
            'id': self._message.id,
            'task_id': self._application_generate_entity.task_id,
            'message_id': self._message.id,
            'conversation_id': self._conversation.id,
            'answer': text,
            'created_at': int(self._message.created_at.timestamp())
        }

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
        data = None
        for k, v in error_responses.items():
            if isinstance(e, k):
                data = v

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

    def _init_output_moderation(self) -> Optional[OutputModeration]:
        """
        Init output moderation.
        :return:
        """
        app_config = self._application_generate_entity.app_config
        sensitive_word_avoidance = app_config.sensitive_word_avoidance

        if sensitive_word_avoidance:
            return OutputModeration(
                tenant_id=app_config.tenant_id,
                app_id=app_config.app_id,
                rule=ModerationRule(
                    type=sensitive_word_avoidance.type,
                    config=sensitive_word_avoidance.config
                ),
                queue_manager=self._queue_manager
            )
