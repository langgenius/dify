import logging
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Union

from sqlalchemy.orm import Session

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.common.graph_runtime_state_support import GraphRuntimeStateSupport
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    AppQueueEvent,
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
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
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
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.repositories.draft_variable_repository import DraftVariableSaverFactory
from core.workflow.runtime import GraphRuntimeState
from core.workflow.system_variable import SystemVariable
from extensions.ext_database import db
from models import Account
from models.enums import CreatorUserRole
from models.model import EndUser
from models.workflow import Workflow, WorkflowAppLog, WorkflowAppLogCreatedFrom

logger = logging.getLogger(__name__)


class WorkflowAppGenerateTaskPipeline(GraphRuntimeStateSupport):
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
        draft_var_saver_factory: DraftVariableSaverFactory,
    ):
        self._base_task_pipeline = BasedGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            stream=stream,
        )

        if isinstance(user, EndUser):
            self._user_id = user.id
            user_session_id = user.session_id
            self._created_by_role = CreatorUserRole.END_USER
        else:
            self._user_id = user.id
            user_session_id = user.id
            self._created_by_role = CreatorUserRole.ACCOUNT

        self._application_generate_entity = application_generate_entity
        self._workflow_features_dict = workflow.features_dict
        self._workflow_execution_id = ""
        self._invoke_from = queue_manager.invoke_from
        self._draft_var_saver_factory = draft_var_saver_factory
        self._workflow = workflow
        self._workflow_system_variables = SystemVariable(
            files=application_generate_entity.files,
            user_id=user_session_id,
            app_id=application_generate_entity.app_config.app_id,
            workflow_id=workflow.id,
            workflow_execution_id=application_generate_entity.workflow_execution_id,
        )
        self._workflow_response_converter = WorkflowResponseConverter(
            application_generate_entity=application_generate_entity,
            user=user,
            system_variables=self._workflow_system_variables,
        )
        self._graph_runtime_state: GraphRuntimeState | None = self._base_task_pipeline.queue_manager.graph_runtime_state

    def process(self) -> Union[WorkflowAppBlockingResponse, Generator[WorkflowAppStreamResponse, None, None]]:
        """
        Process generate task pipeline.
        :return:
        """
        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)
        if self._base_task_pipeline.stream:
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
        self, trace_manager: TraceQueueManager | None = None
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

    def _ensure_workflow_initialized(self):
        """Fluent validation for workflow state."""
        if not self._workflow_execution_id:
            raise ValueError("workflow run not initialized.")

    def _handle_ping_event(self, event: QueuePingEvent, **kwargs) -> Generator[PingStreamResponse, None, None]:
        """Handle ping events."""
        yield self._base_task_pipeline.ping_stream_response()

    def _handle_error_event(self, event: QueueErrorEvent, **kwargs) -> Generator[ErrorStreamResponse, None, None]:
        """Handle error events."""
        err = self._base_task_pipeline.handle_error(event=event)
        yield self._base_task_pipeline.error_to_stream_response(err)

    def _handle_workflow_started_event(
        self, event: QueueWorkflowStartedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow started events."""
        runtime_state = self._resolve_graph_runtime_state()

        run_id = self._extract_workflow_run_id(runtime_state)
        self._workflow_execution_id = run_id
        start_resp = self._workflow_response_converter.workflow_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_run_id=run_id,
            workflow_id=self._workflow.id,
        )
        yield start_resp

    def _handle_node_retry_event(self, event: QueueNodeRetryEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle node retry events."""
        self._ensure_workflow_initialized()

        response = self._workflow_response_converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        if response:
            yield response

    def _handle_node_started_event(
        self, event: QueueNodeStartedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle node started events."""
        self._ensure_workflow_initialized()

        node_start_response = self._workflow_response_converter.workflow_node_start_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        if node_start_response:
            yield node_start_response

    def _handle_node_succeeded_event(
        self, event: QueueNodeSucceededEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle node succeeded events."""
        node_success_response = self._workflow_response_converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        self._save_output_for_event(event, event.node_execution_id)

        if node_success_response:
            yield node_success_response

    def _handle_node_failed_events(
        self,
        event: Union[QueueNodeFailedEvent, QueueNodeExceptionEvent],
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle various node failure events."""
        node_failed_response = self._workflow_response_converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        if isinstance(event, QueueNodeExceptionEvent):
            self._save_output_for_event(event, event.node_execution_id)

        if node_failed_response:
            yield node_failed_response

    def _handle_iteration_start_event(
        self, event: QueueIterationStartEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle iteration start events."""
        self._ensure_workflow_initialized()

        iter_start_resp = self._workflow_response_converter.workflow_iteration_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_execution_id,
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
            workflow_execution_id=self._workflow_execution_id,
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
            workflow_execution_id=self._workflow_execution_id,
            event=event,
        )
        yield iter_finish_resp

    def _handle_loop_start_event(self, event: QueueLoopStartEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle loop start events."""
        self._ensure_workflow_initialized()

        loop_start_resp = self._workflow_response_converter.workflow_loop_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_execution_id,
            event=event,
        )
        yield loop_start_resp

    def _handle_loop_next_event(self, event: QueueLoopNextEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle loop next events."""
        self._ensure_workflow_initialized()

        loop_next_resp = self._workflow_response_converter.workflow_loop_next_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_execution_id=self._workflow_execution_id,
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
            workflow_execution_id=self._workflow_execution_id,
            event=event,
        )
        yield loop_finish_resp

    def _handle_workflow_succeeded_event(
        self,
        event: QueueWorkflowSucceededEvent,
        *,
        trace_manager: TraceQueueManager | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow succeeded events."""
        _ = trace_manager
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized()
        workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_id=self._workflow.id,
            status=WorkflowExecutionStatus.SUCCEEDED,
            graph_runtime_state=validated_state,
        )

        with self._database_session() as session:
            self._save_workflow_app_log(session=session, workflow_run_id=self._workflow_execution_id)

        yield workflow_finish_resp

    def _handle_workflow_partial_success_event(
        self,
        event: QueueWorkflowPartialSuccessEvent,
        *,
        trace_manager: TraceQueueManager | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow partial success events."""
        _ = trace_manager
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized()
        workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_id=self._workflow.id,
            status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            graph_runtime_state=validated_state,
            exceptions_count=event.exceptions_count,
        )

        with self._database_session() as session:
            self._save_workflow_app_log(session=session, workflow_run_id=self._workflow_execution_id)

        yield workflow_finish_resp

    def _handle_workflow_failed_and_stop_events(
        self,
        event: Union[QueueWorkflowFailedEvent, QueueStopEvent],
        *,
        trace_manager: TraceQueueManager | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow failed and stop events."""
        _ = trace_manager
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized()

        if isinstance(event, QueueWorkflowFailedEvent):
            status = WorkflowExecutionStatus.FAILED
            error = event.error
            exceptions_count = event.exceptions_count
        else:
            status = WorkflowExecutionStatus.STOPPED
            error = event.get_stop_reason()
            exceptions_count = 0
        workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_id=self._workflow.id,
            status=status,
            graph_runtime_state=validated_state,
            error=error,
            exceptions_count=exceptions_count,
        )

        with self._database_session() as session:
            self._save_workflow_app_log(session=session, workflow_run_id=self._workflow_execution_id)

        yield workflow_finish_resp

    def _handle_text_chunk_event(
        self,
        event: QueueTextChunkEvent,
        *,
        tts_publisher: AppGeneratorTTSPublisher | None = None,
        queue_message: Union[WorkflowQueueMessage, MessageQueueMessage] | None = None,
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
        event: AppQueueEvent,
        *,
        tts_publisher: AppGeneratorTTSPublisher | None = None,
        trace_manager: TraceQueueManager | None = None,
        queue_message: Union[WorkflowQueueMessage, MessageQueueMessage] | None = None,
    ) -> Generator[StreamResponse, None, None]:
        """Dispatch events using elegant pattern matching."""
        handlers = self._get_event_handlers()
        event_type = type(event)

        # Direct handler lookup
        if handler := handlers.get(event_type):
            yield from handler(
                event,
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
                QueueNodeExceptionEvent,
            ),
        ):
            yield from self._handle_node_failed_events(
                event,
                tts_publisher=tts_publisher,
                trace_manager=trace_manager,
                queue_message=queue_message,
            )
            return

        # Handle workflow failed and stop events with isinstance check
        if isinstance(event, (QueueWorkflowFailedEvent, QueueStopEvent)):
            yield from self._handle_workflow_failed_and_stop_events(
                event,
                tts_publisher=tts_publisher,
                trace_manager=trace_manager,
                queue_message=queue_message,
            )
            return

        # For unhandled events, we continue (original behavior)
        return

    def _process_stream_response(
        self,
        tts_publisher: AppGeneratorTTSPublisher | None = None,
        trace_manager: TraceQueueManager | None = None,
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response using elegant Fluent Python patterns.
        Maintains exact same functionality as original 44-if-statement version.
        """
        for queue_message in self._base_task_pipeline.queue_manager.listen():
            event = queue_message.event

            match event:
                case QueueWorkflowStartedEvent():
                    self._resolve_graph_runtime_state()
                    yield from self._handle_workflow_started_event(event)

                case QueueTextChunkEvent():
                    yield from self._handle_text_chunk_event(
                        event, tts_publisher=tts_publisher, queue_message=queue_message
                    )

                case QueueErrorEvent():
                    yield from self._handle_error_event(event)
                    break

                case QueueWorkflowFailedEvent():
                    yield from self._handle_workflow_failed_and_stop_events(event)
                    break

                case QueueStopEvent():
                    yield from self._handle_workflow_failed_and_stop_events(event)
                    break

                # Handle all other events through elegant dispatch
                case _:
                    if responses := list(
                        self._dispatch_event(
                            event,
                            tts_publisher=tts_publisher,
                            trace_manager=trace_manager,
                            queue_message=queue_message,
                        )
                    ):
                        yield from responses

        if tts_publisher:
            tts_publisher.publish(None)

    def _save_workflow_app_log(self, *, session: Session, workflow_run_id: str | None):
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

        if not workflow_run_id:
            return

        workflow_app_log = WorkflowAppLog()
        workflow_app_log.tenant_id = self._application_generate_entity.app_config.tenant_id
        workflow_app_log.app_id = self._application_generate_entity.app_config.app_id
        workflow_app_log.workflow_id = self._workflow.id
        workflow_app_log.workflow_run_id = workflow_run_id
        workflow_app_log.created_from = created_from.value
        workflow_app_log.created_by_role = self._created_by_role
        workflow_app_log.created_by = self._user_id

        session.add(workflow_app_log)
        session.commit()

    def _text_chunk_to_stream_response(
        self, text: str, from_variable_selector: list[str] | None = None
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
