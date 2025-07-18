import logging
import time
from collections.abc import Generator
from typing import Optional, Union

from sqlalchemy.orm import Session

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import (
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
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.base.tts import AppGeneratorTTSPublisher, AudioTrunk
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.entities.workflow_execution import WorkflowExecution, WorkflowExecutionStatus, WorkflowType
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
                logger.exception(f"Fails to get audio trunk, task_id: {task_id}")
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

        for queue_message in self._base_task_pipeline._queue_manager.listen():
            event = queue_message.event

            if isinstance(event, QueuePingEvent):
                yield self._base_task_pipeline._ping_stream_response()
            elif isinstance(event, QueueErrorEvent):
                err = self._base_task_pipeline._handle_error(event=event)
                yield self._base_task_pipeline._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                # override graph runtime state
                graph_runtime_state = event.graph_runtime_state

                # init workflow run
                workflow_execution = self._workflow_cycle_manager.handle_workflow_run_start()
                self._workflow_run_id = workflow_execution.id_
                start_resp = self._workflow_response_converter.workflow_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_execution=workflow_execution,
                )

                yield start_resp
            elif isinstance(
                event,
                QueueNodeRetryEvent,
            ):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_retried(
                        workflow_execution_id=self._workflow_run_id,
                        event=event,
                    )
                    response = self._workflow_response_converter.workflow_node_retry_to_stream_response(
                        event=event,
                        task_id=self._application_generate_entity.task_id,
                        workflow_node_execution=workflow_node_execution,
                    )
                    session.commit()

                if response:
                    yield response
            elif isinstance(event, QueueNodeStartedEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")

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
            elif isinstance(event, QueueNodeSucceededEvent):
                workflow_node_execution = self._workflow_cycle_manager.handle_workflow_node_execution_success(
                    event=event
                )
                node_success_response = self._workflow_response_converter.workflow_node_finish_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution,
                )

                self._save_output_for_event(event, workflow_node_execution.id)

                if node_success_response:
                    yield node_success_response
            elif isinstance(
                event,
                QueueNodeFailedEvent
                | QueueNodeInIterationFailedEvent
                | QueueNodeInLoopFailedEvent
                | QueueNodeExceptionEvent,
            ):
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
                    raise ValueError("graph runtime state not initialized.")

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_execution = self._workflow_cycle_manager.handle_workflow_run_success(
                        workflow_run_id=self._workflow_run_id,
                        total_tokens=graph_runtime_state.total_tokens,
                        total_steps=graph_runtime_state.node_run_steps,
                        outputs=event.outputs,
                        conversation_id=None,
                        trace_manager=trace_manager,
                    )

                    # save workflow app log
                    self._save_workflow_app_log(session=session, workflow_execution=workflow_execution)

                    workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                        session=session,
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )
                    session.commit()

                yield workflow_finish_resp
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

                    # save workflow app log
                    self._save_workflow_app_log(session=session, workflow_execution=workflow_execution)

                    workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                        session=session,
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )
                    session.commit()

                yield workflow_finish_resp
            elif isinstance(event, QueueWorkflowFailedEvent | QueueStopEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                with Session(db.engine, expire_on_commit=False) as session:
                    workflow_execution = self._workflow_cycle_manager.handle_workflow_run_failed(
                        workflow_run_id=self._workflow_run_id,
                        total_tokens=graph_runtime_state.total_tokens,
                        total_steps=graph_runtime_state.node_run_steps,
                        status=WorkflowExecutionStatus.FAILED
                        if isinstance(event, QueueWorkflowFailedEvent)
                        else WorkflowExecutionStatus.STOPPED,
                        error_message=event.error
                        if isinstance(event, QueueWorkflowFailedEvent)
                        else event.get_stop_reason(),
                        conversation_id=None,
                        trace_manager=trace_manager,
                        exceptions_count=event.exceptions_count if isinstance(event, QueueWorkflowFailedEvent) else 0,
                    )

                    # save workflow app log
                    self._save_workflow_app_log(session=session, workflow_execution=workflow_execution)

                    workflow_finish_resp = self._workflow_response_converter.workflow_finish_to_stream_response(
                        session=session,
                        task_id=self._application_generate_entity.task_id,
                        workflow_execution=workflow_execution,
                    )
                    session.commit()

                yield workflow_finish_resp
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                # only publish tts message at text chunk streaming
                if tts_publisher:
                    tts_publisher.publish(queue_message)

                yield self._text_chunk_to_stream_response(
                    delta_text, from_variable_selector=event.from_variable_selector
                )
            elif isinstance(event, QueueAgentLogEvent):
                yield self._workflow_response_converter.handle_agent_log(
                    task_id=self._application_generate_entity.task_id, event=event
                )
            else:
                continue

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
