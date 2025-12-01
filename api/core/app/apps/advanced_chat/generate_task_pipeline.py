import json
import logging
import re
import time
from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from threading import Thread
from typing import Any, Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.common.graph_runtime_state_support import GraphRuntimeStateSupport
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import (
    MessageQueueMessage,
    QueueAdvancedChatMessageEndEvent,
    QueueAgentLogEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueMessageReplaceEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
    WorkflowQueueMessage,
)
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    PingStreamResponse,
    StreamResponse,
    WorkflowTaskState,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.base.tts import AppGeneratorTTSPublisher, AudioTrunk
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.utils.encoders import jsonable_encoder
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.nodes import NodeType
from core.workflow.repositories.draft_variable_repository import DraftVariableSaverFactory
from core.workflow.runtime import GraphRuntimeState
from core.workflow.system_variable import SystemVariable
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models import Account, Conversation, EndUser, Message, MessageFile
from models.enums import CreatorUserRole
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerateTaskPipeline(GraphRuntimeStateSupport):
    """
    AdvancedChatAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    def __init__(
        self,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Union[Account, EndUser],
        stream: bool,
        dialogue_count: int,
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
        elif isinstance(user, Account):
            self._user_id = user.id
            user_session_id = user.id
            self._created_by_role = CreatorUserRole.ACCOUNT
        else:
            raise NotImplementedError(f"User type not supported: {type(user)}")

        self._workflow_system_variables = SystemVariable(
            query=message.query,
            files=application_generate_entity.files,
            conversation_id=conversation.id,
            user_id=user_session_id,
            dialogue_count=dialogue_count,
            app_id=application_generate_entity.app_config.app_id,
            workflow_id=workflow.id,
            workflow_execution_id=application_generate_entity.workflow_run_id,
        )
        self._workflow_response_converter = WorkflowResponseConverter(
            application_generate_entity=application_generate_entity,
            user=user,
            system_variables=self._workflow_system_variables,
        )

        self._task_state = WorkflowTaskState()
        self._message_cycle_manager = MessageCycleManager(
            application_generate_entity=application_generate_entity, task_state=self._task_state
        )

        self._application_generate_entity = application_generate_entity
        self._workflow_id = workflow.id
        self._workflow_features_dict = workflow.features_dict
        self._conversation_id = conversation.id
        self._conversation_mode = conversation.mode
        self._message_id = message.id
        self._message_created_at = int(message.created_at.timestamp())
        self._conversation_name_generate_thread: Thread | None = None
        self._recorded_files: list[Mapping[str, Any]] = []
        self._workflow_run_id: str = ""
        self._draft_var_saver_factory = draft_var_saver_factory
        self._graph_runtime_state: GraphRuntimeState | None = None
        self._seed_graph_runtime_state_from_queue_manager()

    def process(self) -> Union[ChatbotAppBlockingResponse, Generator[ChatbotAppStreamResponse, None, None]]:
        """
        Process generate task pipeline.
        :return:
        """
        self._conversation_name_generate_thread = self._message_cycle_manager.generate_conversation_name(
            conversation_id=self._conversation_id, query=self._application_generate_entity.query
        )

        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)

        if self._base_task_pipeline.stream:
            return self._to_stream_response(generator)
        else:
            return self._to_blocking_response(generator)

    def _to_blocking_response(self, generator: Generator[StreamResponse, None, None]) -> ChatbotAppBlockingResponse:
        """
        Process blocking response.
        :return:
        """
        for stream_response in generator:
            if isinstance(stream_response, ErrorStreamResponse):
                raise stream_response.err
            elif isinstance(stream_response, MessageEndStreamResponse):
                extras = {}
                if stream_response.metadata:
                    extras["metadata"] = stream_response.metadata

                return ChatbotAppBlockingResponse(
                    task_id=stream_response.task_id,
                    data=ChatbotAppBlockingResponse.Data(
                        id=self._message_id,
                        mode=self._conversation_mode,
                        conversation_id=self._conversation_id,
                        message_id=self._message_id,
                        answer=self._task_state.answer,
                        created_at=self._message_created_at,
                        **extras,
                    ),
                )
            else:
                continue

        raise ValueError("queue listening stopped unexpectedly.")

    def _to_stream_response(
        self, generator: Generator[StreamResponse, None, None]
    ) -> Generator[ChatbotAppStreamResponse, Any, None]:
        """
        To stream response.
        :return:
        """
        for stream_response in generator:
            yield ChatbotAppStreamResponse(
                conversation_id=self._conversation_id,
                message_id=self._message_id,
                created_at=self._message_created_at,
                stream_response=stream_response,
            )

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
                    time.sleep(TTS_AUTO_PLAY_YIELD_CPU_TIME)
                    continue
                if audio_trunk.status == "finish":
                    break
                else:
                    start_listener_time = time.time()
                    yield MessageAudioStreamResponse(audio=audio_trunk.audio, task_id=task_id)
            except Exception:
                logger.exception("Failed to listen audio message, task_id: %s", task_id)
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
        if not self._workflow_run_id:
            raise ValueError("workflow run not initialized.")

    def _handle_ping_event(self, event: QueuePingEvent, **kwargs) -> Generator[PingStreamResponse, None, None]:
        """Handle ping events."""
        yield self._base_task_pipeline.ping_stream_response()

    def _handle_error_event(self, event: QueueErrorEvent, **kwargs) -> Generator[ErrorStreamResponse, None, None]:
        """Handle error events."""
        with self._database_session() as session:
            err = self._base_task_pipeline.handle_error(event=event, session=session, message_id=self._message_id)
        yield self._base_task_pipeline.error_to_stream_response(err)

    def _handle_workflow_started_event(
        self,
        event: QueueWorkflowStartedEvent,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow started events."""
        runtime_state = self._resolve_graph_runtime_state()
        run_id = self._extract_workflow_run_id(runtime_state)
        self._workflow_run_id = run_id

        with self._database_session() as session:
            message = self._get_message(session=session)
            if not message:
                raise ValueError(f"Message not found: {self._message_id}")

            message.workflow_run_id = run_id

        workflow_start_resp = self._workflow_response_converter.workflow_start_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_run_id=run_id,
            workflow_id=self._workflow_id,
        )

        yield workflow_start_resp

    def _handle_node_retry_event(self, event: QueueNodeRetryEvent, **kwargs) -> Generator[StreamResponse, None, None]:
        """Handle node retry events."""
        self._ensure_workflow_initialized()

        node_retry_resp = self._workflow_response_converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        if node_retry_resp:
            yield node_retry_resp

    def _handle_node_started_event(
        self, event: QueueNodeStartedEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle node started events."""
        self._ensure_workflow_initialized()

        node_start_resp = self._workflow_response_converter.workflow_node_start_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        if node_start_resp:
            yield node_start_resp

    def _handle_node_succeeded_event(
        self, event: QueueNodeSucceededEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle node succeeded events."""
        # Record files if it's an answer node or end node
        if event.node_type in [NodeType.ANSWER, NodeType.END, NodeType.LLM]:
            self._recorded_files.extend(
                self._workflow_response_converter.fetch_files_from_node_outputs(event.outputs or {})
            )

        node_finish_resp = self._workflow_response_converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        self._save_output_for_event(event, event.node_execution_id)

        if node_finish_resp:
            yield node_finish_resp

    def _handle_node_failed_events(
        self,
        event: Union[QueueNodeFailedEvent, QueueNodeExceptionEvent],
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle various node failure events."""
        node_finish_resp = self._workflow_response_converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id=self._application_generate_entity.task_id,
        )

        if isinstance(event, QueueNodeExceptionEvent):
            self._save_output_for_event(event, event.node_execution_id)

        if node_finish_resp:
            yield node_finish_resp

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

        # Handle output moderation chunk
        should_direct_answer = self._handle_output_moderation_chunk(delta_text)
        if should_direct_answer:
            return

        current_time = time.perf_counter()
        if self._task_state.first_token_time is None and delta_text.strip():
            self._task_state.first_token_time = current_time
            self._task_state.is_streaming_response = True

        if delta_text.strip():
            self._task_state.last_token_time = current_time

        # Only publish tts message at text chunk streaming
        if tts_publisher and queue_message:
            tts_publisher.publish(queue_message)

        self._task_state.answer += delta_text
        yield self._message_cycle_manager.message_to_stream_response(
            answer=delta_text, message_id=self._message_id, from_variable_selector=event.from_variable_selector
        )

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
        trace_manager: TraceQueueManager | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow succeeded events."""
        _ = trace_manager
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized()
        workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_id=self._workflow_id,
            status=WorkflowExecutionStatus.SUCCEEDED,
            graph_runtime_state=validated_state,
        )

        yield workflow_finish_resp
        self._base_task_pipeline.queue_manager.publish(QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE)

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
            workflow_id=self._workflow_id,
            status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            graph_runtime_state=validated_state,
            exceptions_count=event.exceptions_count,
        )

        yield workflow_finish_resp
        self._base_task_pipeline.queue_manager.publish(QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE)

    def _handle_workflow_failed_event(
        self,
        event: QueueWorkflowFailedEvent,
        *,
        trace_manager: TraceQueueManager | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle workflow failed events."""
        _ = trace_manager
        self._ensure_workflow_initialized()
        validated_state = self._ensure_graph_runtime_initialized()

        workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
            task_id=self._application_generate_entity.task_id,
            workflow_id=self._workflow_id,
            status=WorkflowExecutionStatus.FAILED,
            graph_runtime_state=validated_state,
            error=event.error,
            exceptions_count=event.exceptions_count,
        )

        with self._database_session() as session:
            err_event = QueueErrorEvent(error=ValueError(f"Run failed: {event.error}"))
            err = self._base_task_pipeline.handle_error(event=err_event, session=session, message_id=self._message_id)

        yield workflow_finish_resp
        yield self._base_task_pipeline.error_to_stream_response(err)

    def _handle_stop_event(
        self,
        event: QueueStopEvent,
        *,
        graph_runtime_state: GraphRuntimeState | None = None,
        trace_manager: TraceQueueManager | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle stop events."""
        _ = trace_manager
        resolved_state = None
        if self._workflow_run_id:
            resolved_state = self._resolve_graph_runtime_state(graph_runtime_state)

        if self._workflow_run_id and resolved_state:
            workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                task_id=self._application_generate_entity.task_id,
                workflow_id=self._workflow_id,
                status=WorkflowExecutionStatus.STOPPED,
                graph_runtime_state=resolved_state,
                error=event.get_stop_reason(),
            )

            with self._database_session() as session:
                # Save message
                self._save_message(session=session, graph_runtime_state=resolved_state)

            yield workflow_finish_resp
        elif event.stopped_by in (
            QueueStopEvent.StopBy.INPUT_MODERATION,
            QueueStopEvent.StopBy.ANNOTATION_REPLY,
        ):
            # When hitting input-moderation or annotation-reply, the workflow will not start
            with self._database_session() as session:
                # Save message
                self._save_message(session=session)

        yield self._message_end_to_stream_response()

    def _handle_advanced_chat_message_end_event(
        self,
        event: QueueAdvancedChatMessageEndEvent,
        *,
        graph_runtime_state: GraphRuntimeState | None = None,
        **kwargs,
    ) -> Generator[StreamResponse, None, None]:
        """Handle advanced chat message end events."""
        resolved_state = self._ensure_graph_runtime_initialized(graph_runtime_state)

        output_moderation_answer = self._base_task_pipeline.handle_output_moderation_when_task_finished(
            self._task_state.answer
        )
        if output_moderation_answer:
            self._task_state.answer = output_moderation_answer
            yield self._message_cycle_manager.message_replace_to_stream_response(
                answer=output_moderation_answer,
                reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION,
            )

        # Save message
        with self._database_session() as session:
            self._save_message(session=session, graph_runtime_state=resolved_state)

        yield self._message_end_to_stream_response()

    def _handle_retriever_resources_event(
        self, event: QueueRetrieverResourcesEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle retriever resources events."""
        self._message_cycle_manager.handle_retriever_resources(event)
        return
        yield  # Make this a generator

    def _handle_annotation_reply_event(
        self, event: QueueAnnotationReplyEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle annotation reply events."""
        self._message_cycle_manager.handle_annotation_reply(event)
        return
        yield  # Make this a generator

    def _handle_message_replace_event(
        self, event: QueueMessageReplaceEvent, **kwargs
    ) -> Generator[StreamResponse, None, None]:
        """Handle message replace events."""
        yield self._message_cycle_manager.message_replace_to_stream_response(answer=event.text, reason=event.reason)

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
            QueueWorkflowFailedEvent: self._handle_workflow_failed_event,
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
            # Control events
            QueueStopEvent: self._handle_stop_event,
            # Message events
            QueueRetrieverResourcesEvent: self._handle_retriever_resources_event,
            QueueAnnotationReplyEvent: self._handle_annotation_reply_event,
            QueueMessageReplaceEvent: self._handle_message_replace_event,
            QueueAdvancedChatMessageEndEvent: self._handle_advanced_chat_message_end_event,
            QueueAgentLogEvent: self._handle_agent_log_event,
        }

    def _dispatch_event(
        self,
        event: Any,
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

        # For unhandled events, we continue (original behavior)
        return

    def _process_stream_response(
        self,
        tts_publisher: AppGeneratorTTSPublisher | None = None,
        trace_manager: TraceQueueManager | None = None,
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response using elegant Fluent Python patterns.
        Maintains exact same functionality as original 57-if-statement version.
        """
        for queue_message in self._base_task_pipeline.queue_manager.listen():
            event = queue_message.event

            match event:
                case QueueWorkflowStartedEvent():
                    self._resolve_graph_runtime_state()
                    yield from self._handle_workflow_started_event(event)

                case QueueErrorEvent():
                    yield from self._handle_error_event(event)
                    break

                case QueueWorkflowFailedEvent():
                    yield from self._handle_workflow_failed_event(event, trace_manager=trace_manager)
                    break

                case QueueStopEvent():
                    yield from self._handle_stop_event(event, graph_runtime_state=None, trace_manager=trace_manager)
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

        if self._conversation_name_generate_thread:
            self._conversation_name_generate_thread.join()

    def _save_message(self, *, session: Session, graph_runtime_state: GraphRuntimeState | None = None):
        message = self._get_message(session=session)

        # If there are assistant files, remove markdown image links from answer
        answer_text = self._task_state.answer
        if self._recorded_files:
            # Remove markdown image links since we're storing files separately
            answer_text = re.sub(r"!\[.*?\]\(.*?\)", "", answer_text).strip()

        message.answer = answer_text
        message.updated_at = naive_utc_now()
        message.provider_response_latency = time.perf_counter() - self._base_task_pipeline.start_at

        # Set usage first before dumping metadata
        if graph_runtime_state and graph_runtime_state.llm_usage:
            usage = graph_runtime_state.llm_usage
            message.message_tokens = usage.prompt_tokens
            message.message_unit_price = usage.prompt_unit_price
            message.message_price_unit = usage.prompt_price_unit
            message.answer_tokens = usage.completion_tokens
            message.answer_unit_price = usage.completion_unit_price
            message.answer_price_unit = usage.completion_price_unit
            message.total_price = usage.total_price
            message.currency = usage.currency
            self._task_state.metadata.usage = usage
        else:
            usage = LLMUsage.empty_usage()
            self._task_state.metadata.usage = usage

        # Add streaming metrics to usage if available
        if self._task_state.is_streaming_response and self._task_state.first_token_time:
            start_time = self._base_task_pipeline.start_at
            first_token_time = self._task_state.first_token_time
            last_token_time = self._task_state.last_token_time or first_token_time
            usage.time_to_first_token = round(first_token_time - start_time, 3)
            usage.time_to_generate = round(last_token_time - first_token_time, 3)

        metadata = self._task_state.metadata.model_dump()
        message.message_metadata = json.dumps(jsonable_encoder(metadata))
        message_files = [
            MessageFile(
                message_id=message.id,
                type=file["type"],
                transfer_method=file["transfer_method"],
                url=file["remote_url"],
                belongs_to="assistant",
                upload_file_id=file["related_id"],
                created_by_role=CreatorUserRole.ACCOUNT
                if message.invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
                else CreatorUserRole.END_USER,
                created_by=message.from_account_id or message.from_end_user_id or "",
            )
            for file in self._recorded_files
        ]
        session.add_all(message_files)

    def _seed_graph_runtime_state_from_queue_manager(self) -> None:
        """Bootstrap the cached runtime state from the queue manager when present."""
        candidate = self._base_task_pipeline.queue_manager.graph_runtime_state
        if candidate is not None:
            self._graph_runtime_state = candidate

    def _message_end_to_stream_response(self) -> MessageEndStreamResponse:
        """
        Message end to stream response.
        :return:
        """
        extras = self._task_state.metadata.model_dump()

        if self._task_state.metadata.annotation_reply:
            del extras["annotation_reply"]

        return MessageEndStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=self._message_id,
            files=self._recorded_files,
            metadata=extras,
        )

    def _handle_output_moderation_chunk(self, text: str) -> bool:
        """
        Handle output moderation chunk.
        :param text: text
        :return: True if output moderation should direct output, otherwise False
        """
        if self._base_task_pipeline.output_moderation_handler:
            if self._base_task_pipeline.output_moderation_handler.should_direct_output():
                self._task_state.answer = self._base_task_pipeline.output_moderation_handler.get_final_output()
                self._base_task_pipeline.queue_manager.publish(
                    QueueTextChunkEvent(text=self._task_state.answer), PublishFrom.TASK_PIPELINE
                )

                self._base_task_pipeline.queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION), PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self._base_task_pipeline.output_moderation_handler.append_new_token(text)

        return False

    def _get_message(self, *, session: Session):
        stmt = select(Message).where(Message.id == self._message_id)
        message = session.scalar(stmt)
        if not message:
            raise ValueError(f"Message not found: {self._message_id}")
        return message

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
