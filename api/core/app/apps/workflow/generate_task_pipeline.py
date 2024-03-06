import json
import logging
import time
from collections.abc import Generator
from typing import Optional, Union

from pydantic import BaseModel

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueMessageReplaceEvent,
    QueueNodeFinishedEvent,
    QueueNodeStartedEvent,
    QueuePingEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFinishedEvent,
    QueueWorkflowStartedEvent,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.moderation.output_moderation import ModerationRule, OutputModeration
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecution, WorkflowRun, WorkflowRunStatus

logger = logging.getLogger(__name__)


class TaskState(BaseModel):
    """
    TaskState entity
    """
    answer: str = ""
    metadata: dict = {}
    workflow_run_id: Optional[str] = None


class WorkflowAppGenerateTaskPipeline:
    """
    WorkflowAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    def __init__(self, application_generate_entity: WorkflowAppGenerateEntity,
                 queue_manager: AppQueueManager,
                 stream: bool) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        """
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._task_state = TaskState()
        self._start_at = time.perf_counter()
        self._output_moderation_handler = self._init_output_moderation()
        self._stream = stream

    def process(self) -> Union[dict, Generator]:
        """
        Process generate task pipeline.
        :return:
        """
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
            elif isinstance(event, QueueStopEvent | QueueWorkflowFinishedEvent):
                if isinstance(event, QueueStopEvent):
                    workflow_run = self._get_workflow_run(self._task_state.workflow_run_id)
                else:
                    workflow_run = self._get_workflow_run(event.workflow_run_id)

                if workflow_run.status == WorkflowRunStatus.SUCCEEDED.value:
                    outputs = workflow_run.outputs
                    self._task_state.answer = outputs.get('text', '')
                else:
                    raise self._handle_error(QueueErrorEvent(error=ValueError(f'Run failed: {workflow_run.error}')))

                # response moderation
                if self._output_moderation_handler:
                    self._output_moderation_handler.stop_thread()

                    self._task_state.answer = self._output_moderation_handler.moderation_completion(
                        completion=self._task_state.answer,
                        public_event=False
                    )

                response = {
                    'event': 'workflow_finished',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': event.workflow_run_id,
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
                self._task_state.workflow_run_id = event.workflow_run_id

                workflow_run = self._get_workflow_run(event.workflow_run_id)
                response = {
                    'event': 'workflow_started',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': event.workflow_run_id,
                    'data': {
                        'id': workflow_run.id,
                        'workflow_id': workflow_run.workflow_id,
                        'created_at': int(workflow_run.created_at.timestamp())
                    }
                }

                yield self._yield_response(response)
            elif isinstance(event, QueueNodeStartedEvent):
                workflow_node_execution = self._get_workflow_node_execution(event.workflow_node_execution_id)
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
            elif isinstance(event, QueueNodeFinishedEvent):
                workflow_node_execution = self._get_workflow_node_execution(event.workflow_node_execution_id)
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
            elif isinstance(event, QueueStopEvent | QueueWorkflowFinishedEvent):
                if isinstance(event, QueueStopEvent):
                    workflow_run = self._get_workflow_run(self._task_state.workflow_run_id)
                else:
                    workflow_run = self._get_workflow_run(event.workflow_run_id)

                if workflow_run.status == WorkflowRunStatus.SUCCEEDED.value:
                    outputs = workflow_run.outputs
                    self._task_state.answer = outputs.get('text', '')
                else:
                    err_event = QueueErrorEvent(error=ValueError(f'Run failed: {workflow_run.error}'))
                    data = self._error_to_stream_response_data(self._handle_error(err_event))
                    yield self._yield_response(data)
                    break

                # response moderation
                if self._output_moderation_handler:
                    self._output_moderation_handler.stop_thread()

                    self._task_state.answer = self._output_moderation_handler.moderation_completion(
                        completion=self._task_state.answer,
                        public_event=False
                    )

                    self._output_moderation_handler = None

                    replace_response = {
                        'event': 'text_replace',
                        'task_id': self._application_generate_entity.task_id,
                        'workflow_run_id': self._task_state.workflow_run_id,
                        'data': {
                            'text': self._task_state.answer
                        }
                    }

                    yield self._yield_response(replace_response)

                workflow_run_response = {
                    'event': 'workflow_finished',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': event.workflow_run_id,
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
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.chunk_text
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
                    'event': 'text_replace',
                    'task_id': self._application_generate_entity.task_id,
                    'workflow_run_id': self._task_state.workflow_run_id,
                    'data': {
                        'text': event.text
                    }
                }

                yield self._yield_response(response)
            elif isinstance(event, QueuePingEvent):
                yield "event: ping\n\n"
            else:
                continue

    def _get_workflow_run(self, workflow_run_id: str) -> WorkflowRun:
        """
        Get workflow run.
        :param workflow_run_id: workflow run id
        :return:
        """
        return db.session.query(WorkflowRun).filter(WorkflowRun.id == workflow_run_id).first()

    def _get_workflow_node_execution(self, workflow_node_execution_id: str) -> WorkflowNodeExecution:
        """
        Get workflow node execution.
        :param workflow_node_execution_id: workflow node execution id
        :return:
        """
        return db.session.query(WorkflowNodeExecution).filter(WorkflowNodeExecution.id == workflow_node_execution_id).first()

    def _handle_chunk(self, text: str) -> dict:
        """
        Handle completed event.
        :param text: text
        :return:
        """
        response = {
            'event': 'text_chunk',
            'workflow_run_id': self._task_state.workflow_run_id,
            'task_id': self._application_generate_entity.task_id,
            'data': {
                'text': text
            }
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
            'workflow_run_id': self._task_state.workflow_run_id,
            **data
        }

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
