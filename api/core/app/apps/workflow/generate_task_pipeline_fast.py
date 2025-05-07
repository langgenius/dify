import logging
import time
from datetime import UTC, datetime
from collections.abc import Generator
from typing import Optional, Union

from sqlalchemy.orm import Session

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.advanced_chat.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueErrorEvent,
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
    WorkflowTaskState,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.workflow_cycle_manage import WorkflowCycleManage
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.enums import SystemVariableKey
from extensions.ext_database import db
from models.account import Account
from models.enums import CreatedByRole
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowRun,
    WorkflowRunStatus,
)

logger = logging.getLogger(__name__)


class WorkflowAppGenerateTaskPipelineFast:
    """
    WorkflowAppGenerateTaskPipelineFast is a class that generate stream output and state management for Application.
    """

    def __init__(
        self,
        application_generate_entity: WorkflowAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Union[Account, EndUser],
        stream: bool,
    ) -> None:
        self._base_task_pipeline = BasedGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            stream=stream,
        )

        if isinstance(user, EndUser):
            self._user_id = user.id
            user_session_id = user.session_id
            self._created_by_role = CreatedByRole.END_USER
        elif isinstance(user, Account):
            self._user_id = user.id
            user_session_id = user.id
            self._created_by_role = CreatedByRole.ACCOUNT
        else:
            raise ValueError(f"Invalid user type: {type(user)}")

        self._workflow_cycle_manager = WorkflowCycleManage(
            application_generate_entity=application_generate_entity,
            workflow_system_variables={
                SystemVariableKey.FILES: application_generate_entity.files,
                SystemVariableKey.USER_ID: user_session_id,
                SystemVariableKey.APP_ID: application_generate_entity.app_config.app_id,
                SystemVariableKey.WORKFLOW_ID: workflow.id,
                SystemVariableKey.WORKFLOW_RUN_ID: application_generate_entity.workflow_run_id,
            },
        )

        self._application_generate_entity = application_generate_entity
        self._workflow_id = workflow.id
        self._workflow_features_dict = workflow.features_dict
        self._task_state = WorkflowTaskState()
        self._workflow_run_id = ""

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
                self._workflow_run = self._workflow_cycle_manager._handle_workflow_run_start_fast(
                    session=None,
                    workflow_id=self._workflow_id,
                    user_id=self._user_id,
                    created_by_role=self._created_by_role,
                )
                self._workflow_run_id = self._workflow_run.id

            elif isinstance(event, QueueWorkflowSucceededEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                self._workflow_run.status = WorkflowRunStatus.SUCCEEDED
                self._workflow_run.finished_at = datetime.now(UTC).replace(tzinfo=None)
                self._workflow_run.elapsed_time = (self._workflow_run.finished_at - self._workflow_run.created_at).total_seconds()
                self._workflow_run.outputs = event.outputs

                workflow_finish_resp = self._workflow_cycle_manager._workflow_finish_to_stream_response_fast(
                    session=None,
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=self._workflow_run,
                )

                yield workflow_finish_resp
            elif isinstance(event, QueueWorkflowPartialSuccessEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                self._workflow_run.status = WorkflowRunStatus.PARTIAL_SUCCESSED
                self._workflow_run.finished_at = datetime.now(UTC)
                self._workflow_run.elapsed_time = (self._workflow_run.finished_at - self._workflow_run.created_at).total_seconds()
                self._workflow_run.outputs = event.outputs

                workflow_finish_resp = self._workflow_cycle_manager._workflow_finish_to_stream_response_fast(
                    session=None,
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=self._workflow_run,
                )

                yield workflow_finish_resp
            elif isinstance(event, QueueWorkflowFailedEvent | QueueStopEvent):
                if not self._workflow_run_id:
                    raise ValueError("workflow run not initialized.")
                if not graph_runtime_state:
                    raise ValueError("graph runtime state not initialized.")

                self._workflow_run.status = WorkflowRunStatus.FAILED
                self._workflow_run.finished_at = datetime.now(UTC)
                self._workflow_run.elapsed_time = (self._workflow_run.finished_at - self._workflow_run.created_at).total_seconds() * 1000
                self._workflow_run.error = event.error

                workflow_finish_resp = self._workflow_cycle_manager._workflow_finish_to_stream_response_fast(
                    session=None,
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=self._workflow_run,
                )

                yield workflow_finish_resp
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                # only publish tts message at text chunk streaming
                if tts_publisher:
                    tts_publisher.publish(queue_message)

                self._task_state.answer += delta_text
                yield self._text_chunk_to_stream_response(
                    delta_text, from_variable_selector=event.from_variable_selector
                )
            elif isinstance(event, QueueAgentLogEvent):
                yield self._workflow_cycle_manager._handle_agent_log(
                    task_id=self._application_generate_entity.task_id, event=event
                )
            else:
                continue

        if tts_publisher:
            tts_publisher.publish(None)

    def _save_workflow_app_log(self, *, session: Session, workflow_run: WorkflowRun) -> None:
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
