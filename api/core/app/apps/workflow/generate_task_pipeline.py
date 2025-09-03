import logging
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any, Optional, Union

from sqlalchemy.orm import Session

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    MessageQueueMessage,
    QueueAgentLogEvent,
    QueueErrorEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeInIterationFailedEvent,
    QueueNodeInLoopFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueParallelBranchRunSucceededEvent,
    QueuePingEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
    WorkflowQueueMessage,
)
from core.app.entities.task_entities import (
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    PingStreamResponse,
    StreamResponse,
    TextChunkStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.base.tts import AppGeneratorTTSPublisher, AudioTrunk
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.entities.workflow_execution import WorkflowExecution, WorkflowExecutionStatus, WorkflowType
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.repositories.draft_variable_repository import DraftVariableSaverFactory
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_cycle_manager import CycleManagerWorkflowInfo, WorkflowCycleManager
from extensions.ext_database import db
from models.account import Account
from models.enums import CreatorUserRole
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
)

logger = logging.getLogger(__name__)


class WorkflowAppGenerateTaskPipeline:
    """
    WorkflowAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    def __init__(
        self,
        application_generate_entity: WorkflowAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Union[Account, EndUser],
        stream: bool,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        draft_var_saver_factory: DraftVariableSaverFactory,
    ) -> None:
        self._base_task_pipeline = BasedGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            stream=stream,
        )

        if isinstance(user, EndUser):
            self._user_id = user.id
            user_session_id = user.session_id
            self._created_by_role = CreatorUserRole.END_USER
        elif isinstance(user, Account):
            self._user_id = user.id
            user_session_id = user.id
            self._created_by_role = CreatorUserRole.ACCOUNT
        else:
            raise ValueError(f"Invalid user type: {type(user)}")

        self._workflow_cycle_manager = WorkflowCycleManager(
            application_generate_entity=application_generate_entity,
            workflow_system_variables=SystemVariable(
                files=application_generate_entity.files,
                user_id=user_session_id,
                app_id=application_generate_entity.app_config.app_id,
                workflow_id=workflow.id,
                workflow_execution_id=application_generate_entity.workflow_execution_id,
            ),
            workflow_info=CycleManagerWorkflowInfo(
                workflow_id=workflow.id,
                workflow_type=WorkflowType(workflow.type),
                version=workflow.version,
                graph_data=workflow.graph_dict,
            ),
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
        )

        self._workflow_response_converter = WorkflowResponseConverter(
            application_generate_entity=application_generate_entity,
            user=user,
        )

        self._application_generate_entity = application_generate_entity
        self._workflow_features_dict = workflow.features_dict
        self._workflow_run_id = ""
        self._invoke_from = queue_manager._invoke_from
        self._draft_var_saver_factory = draft_var_saver_factory

    def process(self) -> Union[WorkflowAppBlockingResponse, Generator[WorkflowAppStreamResponse, None, None]]:
        """
        Process generate task pipeline.
        :return:
        """
        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)
        if self._base_task_pipeline._stream:
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

        raise ValueError("queue listening stopped unexpectedly.")

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

    def _listen_audio_msg(self, publisher: AppGeneratorTTSPublisher | None, task_id: str):
        if not publisher:
            return None
        audio_msg = publisher.check_and_get_audio()
        if audio_msg and isinstance(audio_msg, AudioTrunk) and audio_msg.status != "finish":
            return MessageAudioStreamResponse(audio=audio_msg.audio, task_id=task_id)
        return None

    def _wrapper_process_stream_response(
        self, trace_manager: Optional[TraceQueueManager] = None
    ) -> Generator[StreamResponse, None, None]:
        tts_publisher = None
        task_id = self._application_generate_entity.task_id
        tenant_id = self._application_generate_entity.app_config.tenant_id
        features_dict = self._workflow_features_dict

        if (
            features_dict.get("text_to_speech")
            and features_dict["text_to_speech"].get("enabled")
            and features_dict["text_to_speech"].get("autoPlay") == "enabled"
        ):
            tts_publisher = AppGeneratorTTSPublisher(
                tenant_id, features_dict["text_to_speech"].get("voice"), features_dict["text_to_speech"].get("language")
            )

        for response in self._process_stream_response(tts_publisher=tts_publisher, trace_manager=trace_manager):
            while True:
                audio_response = self._listen_audio_msg(publisher=tts_publisher, task_id=task_id)
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
            except Exception:
                logger.exception("Fails to get audio trunk, task_id: %s", task_id)
                break
        if tts_publisher:
            yield MessageAudioEndStreamResponse(audio="", task_id=task_id)

    @contextmanager
    def _database_session(self):
        """Context manager for database sessions."""
        with Session(db.engine, expire_on_commit=False) as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    def _ensure_workflow_initialized(self) -> None:
        """Fluent validation for workflow state."""
        if not self._workflow_run_id:
            raise ValueError("workflow run not initialized.")

    def _ensure_graph_runtime_initialized(self, graph_runtime_state: Optional[GraphRuntimeState]) -> GraphRuntimeState:
        """Fluent validation for graph runtime state."""
        if not graph_runtime_state:
            raise ValueError("graph runtime state not initialized.")
        return graph_runtime_state

    def _handle_ping_event(self, event: QueuePingEvent, **kwargs) -> Generator[PingStreamResponse, None, None]:
        """Handle ping events."""
        yield self._base_task_pipeline._ping_stream_response()

    def _handle_error_event(self, event: QueueErrorEvent, **kwargs) -> Generator[ErrorStreamResponse, None, None]:
        """Handle error events."""
        err = self._base_task_pipeline._handle_error(event=event)
        yield self._base_task_pipeline._error_to_stream_response(err)

    def _handle_workflow_started_event(
        self, event: QueueWorkflowStartedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow started events."""
        # init workflow run
        workflow_execution = self._workflow_cycle_manager.handle_workflow_run_start()
        self._workflow_run_id = workflow_execution.id_
        start_resp = self._workflow_response_converter.workflow_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution=workflow_execution,
        )
        yield start_resp

    def _handle_node_retry_event(self, event: QueueNodeRetryEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle node retry events."""
        self._ensure_workflow_initialized()

        workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_retried(
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        response = self._workflow_response_converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
            workflow_node_execution=workflow_node_execution,
        )

        if response:
            yield response

    def _handle_node_started_event(
        self, event: QueueNodeStartedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle node started events."""
        self._ensure_workflow_initialized()

        workflow_node_execution = self._workflow_cycle_manager.handle_node_execution_start(
            workflow_execution_id=self._workflow_run_id, event=event
        )
        node_start_response = self._workflow_response_converter.workflow_node_start_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
            workflow_node_execution=workflow_node_execution,
        )

        if node_start_response:
            yield node_start_response

    def _handle_node_succeeded_event(
        self, event: QueueNodeSucceededEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle node succeeded events."""
        workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_success(event=event)
        node_success_response = self._workflow_response_converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
            workflow_node_execution=workflow_node_execution,
        )

        self._save_output_for_event(event, workflow_node_execution.id)

        if node_success_response:
            yield node_success_response

    def _handle_node_failed_events(
        self,
        event: Union[
            QueueNodeFailedEvent, QueueNodeInIterationFailedEvent, QueueNodeInLoopFailedEvent, QueueNodeExceptionEvent
        ],
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle various node failure events."""
        workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_failed(
            event=event,
        )
        node_failed_response = self._workflow_response_converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
            workflow_node_execution=workflow_node_execution,
        )

        if isinstance(event, QueueNodeExceptionEvent):
            self._save_output_for_event(event, workflow_node_execution.id)

        if node_failed_response:
            yield node_failed_response

    def _handle_parallel_branch_started_event(
        self, event: QueueParallelBranchRunStartedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle parallel branch started events."""
        self._ensure_workflow_initialized()

        parallel_start_resp = self._workflow_response_converter.workflow_parallel_branch_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield parallel_start_resp

    def _handle_parallel_branch_finished_events(
        self, event: Union[QueueParallelBranchRunSucceededEvent, QueueParallelBranchRunFailedEvent], **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle parallel branch finished events."""
        self._ensure_workflow_initialized()

        parallel_finish_resp = self._workflow_response_converter.workflow_parallel_branch_finished_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield parallel_finish_resp

    def _handle_iteration_start_event(
        self, event: QueueIterationStartEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle iteration start events."""
        self._ensure_workflow_initialized()

        iter_start_resp = self._workflow_response_converter.workflow_iteration_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield iter_start_resp

    def _handle_iteration_next_event(
        self, event: QueueIterationNextEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle iteration next events."""
        self._ensure_workflow_initialized()

        iter_next_resp = self._workflow_response_converter.workflow_iteration_next_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield iter_next_resp

    def _handle_iteration_completed_event(
        self, event: QueueIterationCompletedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle iteration completed events."""
        self._ensure_workflow_initialized()

        iter_finish_resp = self._workflow_response_converter.workflow_iteration_completed_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield iter_finish_resp

    def _handle_loop_start_event(self, event: QueueLoopStartEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle loop start events."""
        self._ensure_workflow_initialized()

        loop_start_resp = self._workflow_response_converter.workflow_loop_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield loop_start_resp

    def _handle_loop_next_event(self, event: QueueLoopNextEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle loop next events."""
        self._ensure_workflow_initialized()

        loop_next_resp = self._workflow_response_converter.workflow_loop_next_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield loop_next_resp

    def _handle_loop_completed_event(
        self, event: QueueLoopCompletedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle loop completed events."""
        self._ensure_workflow_initialized()

        loop_finish_resp = self._workflow_response_converter.workflow_loop_completed_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_run_id,
            event=event,
        )
        yield loop_finish_resp

    def _handle_workflow_succeeded_event(
        self,
        event: QueueWorkflowSucceededEvent,
        *,
        graph_runtime_state: Optional[GraphRuntimeState] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow succeeded events."""
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized(graph_runtime_state)

        with self._database_session() as session:
            workflow_execution = self._workflow_cycle_manager.handle_workflow_run_success(
                workflow_run_id=self._workflow_run_id,
                total_tokens=validated_state.total_tokens,
                total_steps=validated_state.node_run_steps,
                outputs=event.outputs,
                conversation_id=None,
                trace_manager=trace_manager,
                external_trace_id=self._application_generate_entity.extras.get("external_trace_id"),
            )

            # save workflow app log
            self._save_workflow_app_log(session=session, workflow_execution=workflow_execution)

            workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                session=session,
                task_id=self._application_generate_entity.task_id,
                workflow_execution=workflow_execution,
            )

        yield workflow_finish_resp

    def _handle_workflow_partial_success_event(
        self,
        event: QueueWorkflowPartialSuccessEvent,
        *,
        graph_runtime_state: Optional[GraphRuntimeState] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow partial success events."""
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized(graph_runtime_state)

        with self._database_session() as session:
            workflow_execution = self._workflow_cycle_manager.handle_workflow_run_partial_success(
                workflow_run_id=self._workflow_run_id,
                total_tokens=validated_state.total_tokens,
                total_steps=validated_state.node_run_steps,
                outputs=event.outputs,
                exceptions_count=event.exceptions_count,
                conversation_id=None,
                trace_manager=trace_manager,
                external_trace_id=self._application_generate_entity.extras.get("external_trace_id"),
            )

            # save workflow app log
            self._save_workflow_app_log(session=session, workflow_execution=workflow_execution)

            workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                session=session,
                task_id=self._application_generate_entity.task_id,
                workflow_execution=workflow_execution,
            )

        yield workflow_finish_resp

    def _handle_workflow_failed_and_stop_events(
        self,
        event: Union[QueueWorkflowFailedEvent, QueueStopEvent],
        *,
        graph_runtime_state: Optional[GraphRuntimeState] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow failed and stop events."""
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized(graph_runtime_state)

        with self._database_session() as session:
            workflow_execution = self._workflow_cycle_manager.handle_workflow_run_failed(
                workflow_run_id=self._workflow_run_id,
                total_tokens=validated_state.total_tokens,
                total_steps=validated_state.node_run_steps,
                status=WorkflowExecutionStatus.FAILED
                if isinstance(event, QueueWorkflowFailedEvent)
                else WorkflowExecutionStatus.STOPPED,
                error_message=event.error if isinstance(event, QueueWorkflowFailedEvent) else event.get_stop_reason(),
                conversation_id=None,
                trace_manager=trace_manager,
                exceptions_count=event.exceptions_count if isinstance(event, QueueWorkflowFailedEvent) else 0,
                external_trace_id=self._application_generate_entity.extras.get("external_trace_id"),
            )

            # save workflow app log
            self._save_workflow_app_log(session=session, workflow_execution=workflow_execution)

            workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                session=session,
                task_id=self._application_generate_entity.task_id,
                workflow_execution=workflow_execution,
            )

        yield workflow_finish_resp

    def _handle_text_chunk_event(
        self,
        event: QueueTextChunkEvent,
        *,
        tts_publisher: Optional[AppGeneratorTTSPublisher] = None,
        queue_message: Optional[Union[WorkflowQueueMessage, MessageQueueMessage]] = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle text chunk events."""
        delta_text = event.text
        if delta_text is None:
            return

        # only publish tts message at text chunk streaming
        if tts_publisher and queue_message:
            tts_publisher.publish(queue_message)

        yield self._text_chunk_to_stream_response(delta_text, from_variable_selector=event.from_variable_selector)

    def _handle_agent_log_event(self, event: QueueAgentLogEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle agent log events."""
        yield self._workflow_response_converter.handle_agent_log(
            task_id=self._application_generate_entity.task_id, event=event
        )

    def _get_event_handlers(self) -> dict[type, Callable]:
        """Get mapping of event types to their handlers using fluent pattern."""
        return {
            # Basic events
            QueuePingEvent: self._handle_ping_event,
            QueueErrorEvent: self._handle_error_event,
            QueueTextChunkEvent: self._handle_text_chunk_event,
            # Workflow events
            QueueWorkflowStartedEvent: self._handle_workflow_started_event,
            QueueWorkflowSucceededEvent: self._handle_workflow_succeeded_event,
            QueueWorkflowPartialSuccessEvent: self._handle_workflow_partial_success_event,
            # Node events
            QueueNodeRetryEvent: self._handle_node_retry_event,
            QueueNodeStartedEvent: self._handle_node_started_event,
            QueueNodeSucceededEvent: self._handle_node_succeeded_event,
            # Parallel branch events
            QueueParallelBranchRunStartedEvent: self._handle_parallel_branch_started_event,
            # Iteration events
            QueueIterationStartEvent: self._handle_iteration_start_event,
            QueueIterationNextEvent: self._handle_iteration_next_event,
            QueueIterationCompletedEvent: self._handle_iteration_completed_event,
            # Loop events
            QueueLoopStartEvent: self._handle_loop_start_event,
            QueueLoopNextEvent: self._handle_loop_next_event,
            QueueLoopCompletedEvent: self._handle_loop_completed_event,
            # Agent events
            QueueAgentLogEvent: self._handle_agent_log_event,
        }

    def _dispatch_event(
        self,
        event: Any,
        *,
        graph_runtime_state: Optional[GraphRuntimeState] = None,
        tts_publisher: Optional[AppGeneratorTTSPublisher] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        queue_message: Optional[Union[WorkflowQueueMessage, MessageQueueMessage]] = None,
    ) -> Generator[StreamResponse, None, None]:
        """Dispatch events using elegant pattern matching."""
        handlers = self._get_event_handlers()
        event_type = type(event)

        # Direct handler lookup
        if handler := handlers.get(event_type):
            yield from handler(
                event,
                graph_runtime_state=graph_runtime_state,
                tts_publisher=tts_publisher,
                trace_manager=trace_manager,
                queue_message=queue_message,
            )
            return

        # Handle node failure events with isinstance check
        if isinstance(
            event,
            (
                QueueNodeFailedEvent,
                QueueNodeInIterationFailedEvent,
                QueueNodeInLoopFailedEvent,
                QueueNodeExceptionEvent,
            ),
        ):
            yield from self._handle_node_failed_events(
                event,
                graph_runtime_state=graph_runtime_state,
                tts_publisher=tts_publisher,
                trace_manager=trace_manager,
                queue_message=queue_message,
            )
            return

        # Handle parallel branch finished events with isinstance check
        if isinstance(event, (QueueParallelBranchRunSucceededEvent, QueueParallelBranchRunFailedEvent)):
            yield from self._handle_parallel_branch_finished_events(
                event,
                graph_runtime_state=graph_runtime_state,
                tts_publisher=tts_publisher,
                trace_manager=trace_manager,
                queue_message=queue_message,
            )
            return

        # Handle workflow failed and stop events with isinstance check
        if isinstance(event, (QueueWorkflowFailedEvent, QueueStopEvent)):
            yield from self._handle_workflow_failed_and_stop_events(
                event,
                graph_runtime_state=graph_runtime_state,
                tts_publisher=tts_publisher,
                trace_manager=trace_manager,
                queue_message=queue_message,
            )
            return

        # For unhandled events, we continue (original behavior)
        return

    def _process_stream_response(
        self,
        tts_publisher: Optional[AppGeneratorTTSPublisher] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response using elegant Fluent Python patterns.
        Maintains exact same functionality as original 44-if-statement version.
        """
        # Initialize graph runtime state
        graph_runtime_state = None

        for queue_message in self._base_task_pipeline.queue_manager.listen():
            event = queue_message.event

            match event:
                case QueueWorkflowStartedEvent():
                    graph_runtime_state = event.graph_runtime_state
                    yield from self._handle_workflow_started_event(event)

                case QueueTextChunkEvent():
                    yield from self._handle_text_chunk_event(
                        event, tts_publisher=tts_publisher, queue_message=queue_message
                    )

                case QueueErrorEvent():
                    yield from self._handle_error_event(event)
                    break

                # Handle all other events through elegant dispatch
                case _:
                    if responses := list(
                        self._dispatch_event(
                            event,
                            graph_runtime_state=graph_runtime_state,
                            tts_publisher=tts_publisher,
                            trace_manager=trace_manager,
                            queue_message=queue_message,
                        )
                    ):
                        yield from responses

        if tts_publisher:
            tts_publisher.publish(None)

    def _save_workflow_app_log(self, *, session: Session, workflow_execution: WorkflowExecution) -> None:
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
        workflow_app_log.tenant_id = self._application_generate_entity.app_config.tenant_id
        workflow_app_log.app_id = self._application_generate_entity.app_config.app_id
        workflow_app_log.workflow_id = workflow_execution.workflow_id
        workflow_app_log.workflow_run_id = workflow_execution.id_
        workflow_app_log.created_from = created_from.value
        workflow_app_log.created_by_role = self._created_by_role
        workflow_app_log.created_by = self._user_id

        session.add(workflow_app_log)
        session.commit()

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

    def _save_output_for_event(self, event: QueueNodeSucceededEvent | QueueNodeExceptionEvent, node_execution_id: str):
        with Session(db.engine) as session, session.begin():
            saver = self._draft_var_saver_factory(
                session=session,
                app_id=self._application_generate_entity.app_config.app_id,
                node_id=event.node_id,
                node_type=event.node_type,
                node_execution_id=node_execution_id,
                enclosing_node_id=event.in_loop_id or event.in_iteration_id,
            )
            saver.save(event.process_data, event.outputs)
