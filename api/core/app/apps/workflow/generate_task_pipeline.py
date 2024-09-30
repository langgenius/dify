import json
import logging
import time
from collections.abc import Generator
from typing import Any, Optional, Union

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.advanced_chat.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueParallelBranchRunSucceededEvent,
    QueuePingEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    StreamResponse,
    TextChunkStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
    WorkflowTaskState,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.workflow_cycle_manage import WorkflowCycleManage
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.enums import SystemVariableKey
from extensions.ext_database import db
from models.account import Account
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowRun,
    WorkflowRunStatus,
)

logger = logging.getLogger(__name__)


class WorkflowAppGenerateTaskPipeline(BasedGenerateTaskPipeline, WorkflowCycleManage):
    """
    WorkflowAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    _workflow: Workflow
    _user: Union[Account, EndUser]
    _task_state: WorkflowTaskState
    _application_generate_entity: WorkflowAppGenerateEntity
    _workflow_system_variables: dict[SystemVariableKey, Any]

    def __init__(
        self,
        application_generate_entity: WorkflowAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Union[Account, EndUser],
        stream: bool,
    ) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param user: user
        :param stream: is streamed
        """
        super().__init__(application_generate_entity, queue_manager, user, stream)

        if isinstance(self._user, EndUser):
            user_id = self._user.session_id
        else:
            user_id = self._user.id

        self._workflow = workflow
        self._workflow_system_variables = {
            SystemVariableKey.FILES: application_generate_entity.files,
            SystemVariableKey.USER_ID: user_id,
        }

        self._task_state = WorkflowTaskState()

    def process(self) -> Union[WorkflowAppBlockingResponse, Generator[WorkflowAppStreamResponse, None, None]]:
        """
        Process generate task pipeline.
        :return:
        """
        db.session.refresh(self._workflow)
        db.session.refresh(self._user)
        db.session.close()

        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)
        if self._stream:
            return self._to_stream_response(generator)
        else:
            return self._to_blocking_response(generator)

    def _to_blocking_response(self, generator: Generator[StreamResponse, None, None]) -> WorkflowAppBlockingResponse:
        """
        To blocking response.
        :return:
        """
        for stream_response in generator:
            if isinstance(stream_response, ErrorStreamResponse):
                raise stream_response.err
            elif isinstance(stream_response, WorkflowFinishStreamResponse):
                response = WorkflowAppBlockingResponse(
                    task_id=self._application_generate_entity.task_id,
                    workflow_run_id=stream_response.data.id,
                    data=WorkflowAppBlockingResponse.Data(
                        id=stream_response.data.id,
                        workflow_id=stream_response.data.workflow_id,
                        status=stream_response.data.status,
                        outputs=stream_response.data.outputs,
                        error=stream_response.data.error,
                        elapsed_time=stream_response.data.elapsed_time,
                        total_tokens=stream_response.data.total_tokens,
                        total_steps=stream_response.data.total_steps,
                        created_at=int(stream_response.data.created_at),
                        finished_at=int(stream_response.data.finished_at),
                    ),
                )

                return response
            else:
                continue

        raise Exception("Queue listening stopped unexpectedly.")

    def _to_stream_response(
        self, generator: Generator[StreamResponse, None, None]
    ) -> Generator[WorkflowAppStreamResponse, None, None]:
        """
        To stream response.
        :return:
        """
        workflow_run_id = None
        for stream_response in generator:
            if isinstance(stream_response, WorkflowStartStreamResponse):
                workflow_run_id = stream_response.workflow_run_id

            yield WorkflowAppStreamResponse(workflow_run_id=workflow_run_id, stream_response=stream_response)

    def _listen_audio_msg(self, publisher, task_id: str):
        if not publisher:
            return None
        audio_msg: AudioTrunk = publisher.check_and_get_audio()
        if audio_msg and audio_msg.status != "finish":
            return MessageAudioStreamResponse(audio=audio_msg.audio, task_id=task_id)
        return None

    def _wrapper_process_stream_response(
        self, trace_manager: Optional[TraceQueueManager] = None
    ) -> Generator[StreamResponse, None, None]:
        tts_publisher = None
        task_id = self._application_generate_entity.task_id
        tenant_id = self._application_generate_entity.app_config.tenant_id
        features_dict = self._workflow.features_dict

        if (
            features_dict.get("text_to_speech")
            and features_dict["text_to_speech"].get("enabled")
            and features_dict["text_to_speech"].get("autoPlay") == "enabled"
        ):
            tts_publisher = AppGeneratorTTSPublisher(tenant_id, features_dict["text_to_speech"].get("voice"))

        for response in self._process_stream_response(tts_publisher=tts_publisher, trace_manager=trace_manager):
            while True:
                audio_response = self._listen_audio_msg(tts_publisher, task_id=task_id)
                if audio_response:
                    yield audio_response
                else:
                    break
            yield response

        start_listener_time = time.time()
        while (time.time() - start_listener_time) < TTS_AUTO_PLAY_TIMEOUT:
            try:
                if not tts_publisher:
                    break
                audio_trunk = tts_publisher.check_and_get_audio()
                if audio_trunk is None:
                    # release cpu
                    # sleep 20 ms ( 40ms => 1280 byte audio file,20ms => 640 byte audio file)
                    time.sleep(TTS_AUTO_PLAY_YIELD_CPU_TIME)
                    continue
                if audio_trunk.status == "finish":
                    break
                else:
                    yield MessageAudioStreamResponse(audio=audio_trunk.audio, task_id=task_id)
            except Exception as e:
                logger.error(e)
                break
        if tts_publisher:
            yield MessageAudioEndStreamResponse(audio="", task_id=task_id)

    def _process_stream_response(
        self,
        tts_publisher: Optional[AppGeneratorTTSPublisher] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response.
        :return:
        """
        graph_runtime_state = None
        workflow_run = None

        for queue_message in self._queue_manager.listen():
            event = queue_message.event

            if isinstance(event, QueuePingEvent):
                yield self._ping_stream_response()
            elif isinstance(event, QueueErrorEvent):
                err = self._handle_error(event)
                yield self._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                # override graph runtime state
                graph_runtime_state = event.graph_runtime_state

                # init workflow run
                workflow_run = self._handle_workflow_run_start()
                yield self._workflow_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run
                )
            elif isinstance(event, QueueNodeStartedEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                workflow_node_execution = self._handle_node_execution_start(workflow_run=workflow_run, event=event)

                response = self._workflow_node_start_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution,
                )

                if response:
                    yield response
            elif isinstance(event, QueueNodeSucceededEvent):
                workflow_node_execution = self._handle_workflow_node_execution_success(event)

                response = self._workflow_node_finish_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution,
                )

                if response:
                    yield response
            elif isinstance(event, QueueNodeFailedEvent):
                workflow_node_execution = self._handle_workflow_node_execution_failed(event)

                response = self._workflow_node_finish_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution,
                )

                if response:
                    yield response
            elif isinstance(event, QueueParallelBranchRunStartedEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                yield self._workflow_parallel_branch_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run, event=event
                )
            elif isinstance(event, QueueParallelBranchRunSucceededEvent | QueueParallelBranchRunFailedEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                yield self._workflow_parallel_branch_finished_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run, event=event
                )
            elif isinstance(event, QueueIterationStartEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                yield self._workflow_iteration_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run, event=event
                )
            elif isinstance(event, QueueIterationNextEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                yield self._workflow_iteration_next_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run, event=event
                )
            elif isinstance(event, QueueIterationCompletedEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                yield self._workflow_iteration_completed_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run, event=event
                )
            elif isinstance(event, QueueWorkflowSucceededEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                if not graph_runtime_state:
                    raise Exception("Graph runtime state not initialized.")

                workflow_run = self._handle_workflow_run_success(
                    workflow_run=workflow_run,
                    start_at=graph_runtime_state.start_at,
                    total_tokens=graph_runtime_state.total_tokens,
                    total_steps=graph_runtime_state.node_run_steps,
                    outputs=json.dumps(event.outputs)
                    if isinstance(event, QueueWorkflowSucceededEvent) and event.outputs
                    else None,
                    conversation_id=None,
                    trace_manager=trace_manager,
                )

                # save workflow app log
                self._save_workflow_app_log(workflow_run)

                yield self._workflow_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run
                )
            elif isinstance(event, QueueWorkflowFailedEvent | QueueStopEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                if not graph_runtime_state:
                    raise Exception("Graph runtime state not initialized.")

                workflow_run = self._handle_workflow_run_failed(
                    workflow_run=workflow_run,
                    start_at=graph_runtime_state.start_at,
                    total_tokens=graph_runtime_state.total_tokens,
                    total_steps=graph_runtime_state.node_run_steps,
                    status=WorkflowRunStatus.FAILED
                    if isinstance(event, QueueWorkflowFailedEvent)
                    else WorkflowRunStatus.STOPPED,
                    error=event.error if isinstance(event, QueueWorkflowFailedEvent) else event.get_stop_reason(),
                    conversation_id=None,
                    trace_manager=trace_manager,
                )

                # save workflow app log
                self._save_workflow_app_log(workflow_run)

                yield self._workflow_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run
                )
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                # only publish tts message at text chunk streaming
                if tts_publisher:
                    tts_publisher.publish(message=queue_message)

                self._task_state.answer += delta_text
                yield self._text_chunk_to_stream_response(
                    delta_text, from_variable_selector=event.from_variable_selector
                )
            else:
                continue

        if tts_publisher:
            tts_publisher.publish(None)

    def _save_workflow_app_log(self, workflow_run: WorkflowRun) -> None:
        """
        Save workflow app log.
        :return:
        """
        invoke_from = self._application_generate_entity.invoke_from
        if invoke_from == InvokeFrom.SERVICE_API:
            created_from = WorkflowAppLogCreatedFrom.SERVICE_API
        elif invoke_from == InvokeFrom.EXPLORE:
            created_from = WorkflowAppLogCreatedFrom.INSTALLED_APP
        elif invoke_from == InvokeFrom.WEB_APP:
            created_from = WorkflowAppLogCreatedFrom.WEB_APP
        else:
            # not save log for debugging
            return

        workflow_app_log = WorkflowAppLog()
        workflow_app_log.tenant_id = workflow_run.tenant_id
        workflow_app_log.app_id = workflow_run.app_id
        workflow_app_log.workflow_id = workflow_run.workflow_id
        workflow_app_log.workflow_run_id = workflow_run.id
        workflow_app_log.created_from = created_from.value
        workflow_app_log.created_by_role = "account" if isinstance(self._user, Account) else "end_user"
        workflow_app_log.created_by = self._user.id

        db.session.add(workflow_app_log)
        db.session.commit()
        db.session.close()

    def _text_chunk_to_stream_response(
        self, text: str, from_variable_selector: Optional[list[str]] = None
    ) -> TextChunkStreamResponse:
        """
        Handle completed event.
        :param text: text
        :return:
        """
        response = TextChunkStreamResponse(
            task_id=self._application_generate_entity.task_id,
            data=TextChunkStreamResponse.Data(text=text, from_variable_selector=from_variable_selector),
        )

        return response
