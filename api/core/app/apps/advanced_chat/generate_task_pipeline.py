import json
import logging
import time
from collections.abc import Generator
from typing import Any, Optional, Union

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.advanced_chat.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueAdvancedChatMessageEndEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueMessageReplaceEvent,
    QueueNodeFailedEvent,
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
from core.app.task_pipeline.message_cycle_manage import MessageCycleManage
from core.app.task_pipeline.workflow_cycle_manage import WorkflowCycleManage
from core.model_runtime.utils.encoders import jsonable_encoder
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from events.message_event import message_was_created
from extensions.ext_database import db
from models.account import Account
from models.model import Conversation, EndUser, Message
from models.workflow import (
    Workflow,
    WorkflowRunStatus,
)

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerateTaskPipeline(BasedGenerateTaskPipeline, WorkflowCycleManage, MessageCycleManage):
    """
    AdvancedChatAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    _task_state: WorkflowTaskState
    _application_generate_entity: AdvancedChatAppGenerateEntity
    _workflow: Workflow
    _user: Union[Account, EndUser]
    _workflow_system_variables: dict[SystemVariableKey, Any]

    def __init__(
        self,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Union[Account, EndUser],
        stream: bool,
    ) -> None:
        """
        Initialize AdvancedChatAppGenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param user: user
        :param stream: stream
        """
        super().__init__(application_generate_entity, queue_manager, user, stream)

        if isinstance(self._user, EndUser):
            user_id = self._user.session_id
        else:
            user_id = self._user.id

        self._workflow = workflow
        self._conversation = conversation
        self._message = message
        self._workflow_system_variables = {
            SystemVariableKey.QUERY: message.query,
            SystemVariableKey.FILES: application_generate_entity.files,
            SystemVariableKey.CONVERSATION_ID: conversation.id,
            SystemVariableKey.USER_ID: user_id,
        }

        self._task_state = WorkflowTaskState()

        self._conversation_name_generate_thread = None

    def process(self):
        """
        Process generate task pipeline.
        :return:
        """
        db.session.refresh(self._workflow)
        db.session.refresh(self._user)
        db.session.close()

        # start generate conversation name thread
        self._conversation_name_generate_thread = self._generate_conversation_name(
            self._conversation, self._application_generate_entity.query
        )

        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)

        if self._stream:
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
                        id=self._message.id,
                        mode=self._conversation.mode,
                        conversation_id=self._conversation.id,
                        message_id=self._message.id,
                        answer=self._task_state.answer,
                        created_at=int(self._message.created_at.timestamp()),
                        **extras,
                    ),
                )
            else:
                continue

        raise Exception("Queue listening stopped unexpectedly.")

    def _to_stream_response(
        self, generator: Generator[StreamResponse, None, None]
    ) -> Generator[ChatbotAppStreamResponse, Any, None]:
        """
        To stream response.
        :return:
        """
        for stream_response in generator:
            yield ChatbotAppStreamResponse(
                conversation_id=self._conversation.id,
                message_id=self._message.id,
                created_at=int(self._message.created_at.timestamp()),
                stream_response=stream_response,
            )

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
        # init fake graph runtime state
        graph_runtime_state = None
        workflow_run = None

        for queue_message in self._queue_manager.listen():
            event = queue_message.event

            if isinstance(event, QueuePingEvent):
                yield self._ping_stream_response()
            elif isinstance(event, QueueErrorEvent):
                err = self._handle_error(event, self._message)
                yield self._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                # override graph runtime state
                graph_runtime_state = event.graph_runtime_state

                # init workflow run
                workflow_run = self._handle_workflow_run_start()

                self._refetch_message()
                self._message.workflow_run_id = workflow_run.id

                db.session.commit()
                db.session.refresh(self._message)
                db.session.close()

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
                    outputs=json.dumps(event.outputs) if event.outputs else None,
                    conversation_id=self._conversation.id,
                    trace_manager=trace_manager,
                )

                yield self._workflow_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run
                )

                self._queue_manager.publish(QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE)
            elif isinstance(event, QueueWorkflowFailedEvent):
                if not workflow_run:
                    raise Exception("Workflow run not initialized.")

                if not graph_runtime_state:
                    raise Exception("Graph runtime state not initialized.")

                workflow_run = self._handle_workflow_run_failed(
                    workflow_run=workflow_run,
                    start_at=graph_runtime_state.start_at,
                    total_tokens=graph_runtime_state.total_tokens,
                    total_steps=graph_runtime_state.node_run_steps,
                    status=WorkflowRunStatus.FAILED,
                    error=event.error,
                    conversation_id=self._conversation.id,
                    trace_manager=trace_manager,
                )

                yield self._workflow_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id, workflow_run=workflow_run
                )

                err_event = QueueErrorEvent(error=ValueError(f"Run failed: {workflow_run.error}"))
                yield self._error_to_stream_response(self._handle_error(err_event, self._message))
                break
            elif isinstance(event, QueueStopEvent):
                if workflow_run and graph_runtime_state:
                    workflow_run = self._handle_workflow_run_failed(
                        workflow_run=workflow_run,
                        start_at=graph_runtime_state.start_at,
                        total_tokens=graph_runtime_state.total_tokens,
                        total_steps=graph_runtime_state.node_run_steps,
                        status=WorkflowRunStatus.STOPPED,
                        error=event.get_stop_reason(),
                        conversation_id=self._conversation.id,
                        trace_manager=trace_manager,
                    )

                    yield self._workflow_finish_to_stream_response(
                        task_id=self._application_generate_entity.task_id, workflow_run=workflow_run
                    )

                # Save message
                self._save_message(graph_runtime_state=graph_runtime_state)

                yield self._message_end_to_stream_response()
                break
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._handle_retriever_resources(event)

                self._refetch_message()

                self._message.message_metadata = (
                    json.dumps(jsonable_encoder(self._task_state.metadata)) if self._task_state.metadata else None
                )

                db.session.commit()
                db.session.refresh(self._message)
                db.session.close()
            elif isinstance(event, QueueAnnotationReplyEvent):
                self._handle_annotation_reply(event)

                self._refetch_message()

                self._message.message_metadata = (
                    json.dumps(jsonable_encoder(self._task_state.metadata)) if self._task_state.metadata else None
                )

                db.session.commit()
                db.session.refresh(self._message)
                db.session.close()
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
                    tts_publisher.publish(message=queue_message)

                self._task_state.answer += delta_text
                yield self._message_to_stream_response(
                    answer=delta_text, message_id=self._message.id, from_variable_selector=event.from_variable_selector
                )
            elif isinstance(event, QueueMessageReplaceEvent):
                # published by moderation
                yield self._message_replace_to_stream_response(answer=event.text)
            elif isinstance(event, QueueAdvancedChatMessageEndEvent):
                if not graph_runtime_state:
                    raise Exception("Graph runtime state not initialized.")

                output_moderation_answer = self._handle_output_moderation_when_task_finished(self._task_state.answer)
                if output_moderation_answer:
                    self._task_state.answer = output_moderation_answer
                    yield self._message_replace_to_stream_response(answer=output_moderation_answer)

                # Save message
                self._save_message(graph_runtime_state=graph_runtime_state)

                yield self._message_end_to_stream_response()
            else:
                continue

        # publish None when task finished
        if tts_publisher:
            tts_publisher.publish(None)

        if self._conversation_name_generate_thread:
            self._conversation_name_generate_thread.join()

    def _save_message(self, graph_runtime_state: Optional[GraphRuntimeState] = None) -> None:
        """
        Save message.
        :return:
        """
        self._refetch_message()

        self._message.answer = self._task_state.answer
        self._message.provider_response_latency = time.perf_counter() - self._start_at
        self._message.message_metadata = (
            json.dumps(jsonable_encoder(self._task_state.metadata)) if self._task_state.metadata else None
        )

        if graph_runtime_state and graph_runtime_state.llm_usage:
            usage = graph_runtime_state.llm_usage
            self._message.message_tokens = usage.prompt_tokens
            self._message.message_unit_price = usage.prompt_unit_price
            self._message.message_price_unit = usage.prompt_price_unit
            self._message.answer_tokens = usage.completion_tokens
            self._message.answer_unit_price = usage.completion_unit_price
            self._message.answer_price_unit = usage.completion_price_unit
            self._message.total_price = usage.total_price
            self._message.currency = usage.currency

        db.session.commit()

        message_was_created.send(
            self._message,
            application_generate_entity=self._application_generate_entity,
            conversation=self._conversation,
            is_first_message=self._application_generate_entity.conversation_id is None,
            extras=self._application_generate_entity.extras,
        )

    def _message_end_to_stream_response(self) -> MessageEndStreamResponse:
        """
        Message end to stream response.
        :return:
        """
        extras = {}
        if self._task_state.metadata:
            extras["metadata"] = self._task_state.metadata.copy()

            if "annotation_reply" in extras["metadata"]:
                del extras["metadata"]["annotation_reply"]

        return MessageEndStreamResponse(
            task_id=self._application_generate_entity.task_id, id=self._message.id, **extras
        )

    def _handle_output_moderation_chunk(self, text: str) -> bool:
        """
        Handle output moderation chunk.
        :param text: text
        :return: True if output moderation should direct output, otherwise False
        """
        if self._output_moderation_handler:
            if self._output_moderation_handler.should_direct_output():
                # stop subscribe new token when output moderation should direct output
                self._task_state.answer = self._output_moderation_handler.get_final_output()
                self._queue_manager.publish(
                    QueueTextChunkEvent(text=self._task_state.answer), PublishFrom.TASK_PIPELINE
                )

                self._queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION), PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self._output_moderation_handler.append_new_token(text)

        return False

    def _refetch_message(self) -> None:
        """
        Refetch message.
        :return:
        """
        message = db.session.query(Message).filter(Message.id == self._message.id).first()
        if message:
            self._message = message
