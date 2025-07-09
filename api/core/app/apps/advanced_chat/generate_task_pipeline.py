import logging
import time
from collections.abc import Generator, Mapping
from threading import Thread
from typing import Any, Optional, Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import (
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
    QueueNodeInIterationFailedEvent,
    QueueNodeInLoopFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueParallelBranchRunSucceededEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    StreamResponse,
    WorkflowTaskState,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.base.tts import AppGeneratorTTSPublisher, AudioTrunk
from core.model_runtime.entities.llm_entities import LLMUsage
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.entities.workflow_execution import WorkflowExecutionStatus, WorkflowType
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes import NodeType
from core.workflow.repositories.draft_variable_repository import DraftVariableSaverFactory
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_cycle_manager import CycleManagerWorkflowInfo, WorkflowCycleManager
from events.message_event import message_was_created
from extensions.ext_database import db
from models import Conversation, EndUser, Message, MessageFile
from models.account import Account
from models.enums import CreatorUserRole
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerateTaskPipeline:
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
            raise NotImplementedError(f"User type not supported: {type(user)}")

        self._workflow_cycle_manager = WorkflowCycleManager(
            application_generate_entity=application_generate_entity,
            workflow_system_variables=SystemVariable(
                query=message.query,
                files=application_generate_entity.files,
                conversation_id=conversation.id,
                user_id=user_session_id,
                dialogue_count=dialogue_count,
                app_id=application_generate_entity.app_config.app_id,
                workflow_id=workflow.id,
                workflow_execution_id=application_generate_entity.workflow_run_id,
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

    def process(self) -> Union[ChatbotAppBlockingResponse, Generator[ChatbotAppStreamResponse, None, None]]:
        """
        Process generate task pipeline.
        :return:
        """
        # start generate conversation name thread
        self._conversation_name_generate_thread = self._message_cycle_manager.generate_conversation_name(
            conversation_id=self._conversation_id, query=self._application_generate_entity.query
        )

        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)

        if self._base_task_pipeline._stream:
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
        # timeout
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
                    start_listener_time = time.time()
                    yield MessageAudioStreamResponse(audio=audio_trunk.audio, task_id=task_id)
            except Exception:
                logger.exception(f"Failed to listen audio message, task_id: {task_id}")
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
        # init fake graph runtime state
        graph_runtime_state: Optional[GraphRuntimeState] = None

        for queue_message in self._base_task_pipeline._queue_manager.listen():
            event = queue_message.event

            if isinstance(event, QueuePingEvent):
                yield self._base_task_pipeline._ping_stream_response()
            elif isinstance(event, QueueErrorEvent):
                with Session(db.engine, expire_on_commit=False) as session:
                    err = self._base_task_pipeline._handle_error(
                        event=event, session=session, message_id=self._message_id
                    )
                    session.commit()
                yield self._base_task_pipeline._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                # override graph runtime state
                graph_runtime_state = event.graph_runtime_state

                with Session(db.engine, expire_on_commit=False) as session:
                    # init workflow run
                    workflow_execution = self._workflow_cycle_manager.handle_workflow_run_start()
                    self._workflow_run_id = workflow_execution.id_
                    message = self._get_message(session=session)
                    if not message:
                        raise ValueError(f"Message not found: {self._message_id}")
                    message.workflow_run_id = workflow_execution.id_
                    workflow_start_resp = self._workflow_response_converter.workflow_start_to_stream_response(
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )
                    session.commit()

                yield workflow_start_resp
            elif isinstance(
                event,
                QueueNodeRetryEvent,
            ):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_retried(
                        workflow_execution_id=self._workflow_run_id, event=event
                    )
                    node_retry_resp = self._workflow_response_converter.workflow_node_retry_to_stream_response(
                        event=event,
                        task_id=self._application_generate_entity.task_id,
                        workflow_node_execution=workflow_node_execution,
                    )
                    session.commit()

                if node_retry_resp:
                    yield node_retry_resp
            elif isinstance(event, QueueNodeStartedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                workflow_node_execution = self._workflow_cycle_manager.handle_node_execution_start(
                    workflow_execution_id=self._workflow_run_id, event=event
                )

                node_start_resp = self._workflow_response_converter.workflow_node_start_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution,
                )

                if node_start_resp:
                    yield node_start_resp
            elif isinstance(event, QueueNodeSucceededEvent):
                # Record files if it's an answer node or end node
                if event.node_type in [NodeType.ANSWER, NodeType.END]:
                    self._recorded_files.extend(
                        self._workflow_response_converter.fetch_files_from_node_outputs(event.outputs or {})
                    )

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_success(
                        event=event
                    )

                    node_finish_resp = self._workflow_response_converter.workflow_node_finish_to_stream_response(
                        event=event,
                        task_id=self._application_generate_entity.task_id,
                        workflow_node_execution=workflow_node_execution,
                    )
                    session.commit()
                self._save_output_for_event(event, workflow_node_execution.id)

                if node_finish_resp:
                    yield node_finish_resp
            elif isinstance(
                event,
                QueueNodeFailedEvent
                | QueueNodeInIterationFailedEvent
                | QueueNodeInLoopFailedEvent
                | QueueNodeExceptionEvent,
            ):
                workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_failed(
                    event=event
                )

                node_finish_resp = self._workflow_response_converter.workflow_node_finish_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution,
                )
                if isinstance(event, QueueNodeExceptionEvent):
                    self._save_output_for_event(event, workflow_node_execution.id)

                if node_finish_resp:
                    yield node_finish_resp
            elif isinstance(event, QueueParallelBranchRunStartedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                parallel_start_resp = (
                    self._workflow_response_converter.workflow_parallel_branch_start_to_stream_response(
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution_id=self._workflow_run_id,
                        event=event,
                    )
                )

                yield parallel_start_resp
            elif isinstance(event, QueueParallelBranchRunSucceededEvent | QueueParallelBranchRunFailedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                parallel_finish_resp = (
                    self._workflow_response_converter.workflow_parallel_branch_finished_to_stream_response(
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution_id=self._workflow_run_id,
                        event=event,
                    )
                )

                yield parallel_finish_resp
            elif isinstance(event, QueueIterationStartEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                iter_start_resp = self._workflow_response_converter.workflow_iteration_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution_id=self._workflow_run_id,
                    event=event,
                )

                yield iter_start_resp
            elif isinstance(event, QueueIterationNextEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                iter_next_resp = self._workflow_response_converter.workflow_iteration_next_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution_id=self._workflow_run_id,
                    event=event,
                )

                yield iter_next_resp
            elif isinstance(event, QueueIterationCompletedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                iter_finish_resp = self._workflow_response_converter.workflow_iteration_completed_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution_id=self._workflow_run_id,
                    event=event,
                )

                yield iter_finish_resp
            elif isinstance(event, QueueLoopStartEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                loop_start_resp = self._workflow_response_converter.workflow_loop_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution_id=self._workflow_run_id,
                    event=event,
                )

                yield loop_start_resp
            elif isinstance(event, QueueLoopNextEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                loop_next_resp = self._workflow_response_converter.workflow_loop_next_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution_id=self._workflow_run_id,
                    event=event,
                )

                yield loop_next_resp
            elif isinstance(event, QueueLoopCompletedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                loop_finish_resp = self._workflow_response_converter.workflow_loop_completed_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution_id=self._workflow_run_id,
                    event=event,
                )

                yield loop_finish_resp
            elif isinstance(event, QueueWorkflowSucceededEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

                if not graph_runtime_state:
                    raise ValueError("workflow run not initialized.")

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_execution = self._workflow_cycle_manager.handle_workflow_run_success(
                        workflow_run_id=self._workflow_run_id,
                        total_tokens=graph_runtime_state.total_tokens,
                        total_steps=graph_runtime_state.node_run_steps,
                        outputs=event.outputs,
                        conversation_id=self._conversation_id,
                        trace_manager=trace_manager,
                    )

                    workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                        session=session,
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )

                yield workflow_finish_resp
                self._base_task_pipeline._queue_manager.publish(
                    QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE
                )
            elif isinstance(event, QueueWorkflowPartialSuccessEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_execution = self._workflow_cycle_manager.handle_workflow_run_partial_success(
                        workflow_run_id=self._workflow_run_id,
                        total_tokens=graph_runtime_state.total_tokens,
                        total_steps=graph_runtime_state.node_run_steps,
                        outputs=event.outputs,
                        exceptions_count=event.exceptions_count,
                        conversation_id=None,
                        trace_manager=trace_manager,
                    )
                    workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                        session=session,
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )

                yield workflow_finish_resp
                self._base_task_pipeline._queue_manager.publish(
                    QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE
                )
            elif isinstance(event, QueueWorkflowFailedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_execution = self._workflow_cycle_manager.handle_workflow_run_failed(
                        workflow_run_id=self._workflow_run_id,
                        total_tokens=graph_runtime_state.total_tokens,
                        total_steps=graph_runtime_state.node_run_steps,
                        status=WorkflowExecutionStatus.FAILED,
                        error_message=event.error,
                        conversation_id=self._conversation_id,
                        trace_manager=trace_manager,
                        exceptions_count=event.exceptions_count,
                    )
                    workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                        session=session,
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )
                    err_event = QueueErrorEvent(error=ValueError(f"Run failed: {workflow_execution.error_message}"))
                    err = self._base_task_pipeline._handle_error(
                        event=err_event, session=session, message_id=self._message_id
                    )

                yield workflow_finish_resp
                yield self._base_task_pipeline._error_to_stream_response(err)
                break
            elif isinstance(event, QueueStopEvent):
                if self._workflow_run_id and graph_runtime_state:
                    with Session(db.engine, expire_on_commit=False) as session:
                        workflow_execution = self._workflow_cycle_manager.handle_workflow_run_failed(
                            workflow_run_id=self._workflow_run_id,
                            total_tokens=graph_runtime_state.total_tokens,
                            total_steps=graph_runtime_state.node_run_steps,
                            status=WorkflowExecutionStatus.STOPPED,
                            error_message=event.get_stop_reason(),
                            conversation_id=self._conversation_id,
                            trace_manager=trace_manager,
                        )
                        workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                            session=session,
                            task_id=self._application_generate_entity.task_id,
                            workflow_execution=workflow_execution,
                        )
                        # Save message
                        self._save_message(session=session, graph_runtime_state=graph_runtime_state)
                        session.commit()

                    yield workflow_finish_resp
                elif event.stopped_by in (
                    QueueStopEvent.StopBy.INPUT_MODERATION,
                    QueueStopEvent.StopBy.ANNOTATION_REPLY,
                ):
                    # When hitting input-moderation or annotation-reply, the workflow will not start
                    with Session(db.engine, expire_on_commit=False) as session:
                        # Save message
                        self._save_message(session=session)
                        session.commit()

                yield self._message_end_to_stream_response()
                break
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._message_cycle_manager.handle_retriever_resources(event)

                with Session(db.engine, expire_on_commit=False) as session:
                    message = self._get_message(session=session)
                    message.message_metadata = self._task_state.metadata.model_dump_json()
                    session.commit()
            elif isinstance(event, QueueAnnotationReplyEvent):
                self._message_cycle_manager.handle_annotation_reply(event)

                with Session(db.engine, expire_on_commit=False) as session:
                    message = self._get_message(session=session)
                    message.message_metadata = self._task_state.metadata.model_dump_json()
                    session.commit()
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                # handle output moderation chunk
                should_direct_answer = self._handle_output_moderation_chunk(delta_text)
                if should_direct_answer:
                    continue

                # only publish tts message at text chunk streaming
                if tts_publisher:
                    tts_publisher.publish(queue_message)

                self._task_state.answer += delta_text
                yield self._message_cycle_manager.message_to_stream_response(
                    answer=delta_text, message_id=self._message_id, from_variable_selector=event.from_variable_selector
                )
            elif isinstance(event, QueueMessageReplaceEvent):
                # published by moderation
                yield self._message_cycle_manager.message_replace_to_stream_response(
                    answer=event.text, reason=event.reason
                )
            elif isinstance(event, QueueAdvancedChatMessageEndEvent):
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                output_moderation_answer = self._base_task_pipeline._handle_output_moderation_when_task_finished(
                    self._task_state.answer
                )
                if output_moderation_answer:
                    self._task_state.answer = output_moderation_answer
                    yield self._message_cycle_manager.message_replace_to_stream_response(
                        answer=output_moderation_answer,
                        reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION,
                    )

                # Save message
                with Session(db.engine, expire_on_commit=False) as session:
                    self._save_message(session=session, graph_runtime_state=graph_runtime_state)
                    session.commit()

                yield self._message_end_to_stream_response()
            elif isinstance(event, QueueAgentLogEvent):
                yield self._workflow_response_converter.handle_agent_log(
                    task_id=self._application_generate_entity.task_id, event=event
                )
            else:
                continue

        # publish None when task finished
        if tts_publisher:
            tts_publisher.publish(None)

        if self._conversation_name_generate_thread:
            self._conversation_name_generate_thread.join()

    def _save_message(self, *, session: Session, graph_runtime_state: Optional[GraphRuntimeState] = None) -> None:
        message = self._get_message(session=session)
        message.answer = self._task_state.answer
        message.provider_response_latency = time.perf_counter() - self._base_task_pipeline._start_at
        message.message_metadata = self._task_state.metadata.model_dump_json()
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
            self._task_state.metadata.usage = LLMUsage.empty_usage()
        message_was_created.send(
            message,
            application_generate_entity=self._application_generate_entity,
        )

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
        if self._base_task_pipeline._output_moderation_handler:
            if self._base_task_pipeline._output_moderation_handler.should_direct_output():
                # stop subscribe new token when output moderation should direct output
                self._task_state.answer = self._base_task_pipeline._output_moderation_handler.get_final_output()
                self._base_task_pipeline._queue_manager.publish(
                    QueueTextChunkEvent(text=self._task_state.answer), PublishFrom.TASK_PIPELINE
                )

                self._base_task_pipeline._queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION), PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self._base_task_pipeline._output_moderation_handler.append_new_token(text)

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
