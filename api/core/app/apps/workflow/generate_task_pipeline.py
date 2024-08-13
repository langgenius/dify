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
    QueueMessageReplaceEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
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
    TextReplaceStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowTaskState,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.workflow_cycle_manage import WorkflowCycleManage
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.entities.node_entities import SystemVariable
from extensions.ext_database import db
from models.account import Account
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowRun,
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
    _workflow_system_variables: dict[SystemVariable, Any]

    def __init__(self, application_generate_entity: WorkflowAppGenerateEntity,
                 workflow: Workflow,
                 queue_manager: AppQueueManager,
                 user: Union[Account, EndUser],
                 stream: bool) -> None:
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
            SystemVariable.FILES: application_generate_entity.files,
            SystemVariable.USER_ID: user_id
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

        generator = self._wrapper_process_stream_response(
            trace_manager=self._application_generate_entity.trace_manager
        )
        if self._stream:
            return self._to_stream_response(generator)
        else:
            return self._to_blocking_response(generator)

    def _to_blocking_response(self, generator: Generator[StreamResponse, None, None]) \
            -> WorkflowAppBlockingResponse:
        """
        To blocking response.
        :return:
        """
        for stream_response in generator:
            if isinstance(stream_response, ErrorStreamResponse):
                raise stream_response.err
            elif isinstance(stream_response, WorkflowFinishStreamResponse):
                workflow_run = self._task_state.workflow_run
                if not workflow_run:
                    raise Exception('Workflow run not found.')

                response = WorkflowAppBlockingResponse(
                    task_id=self._application_generate_entity.task_id,
                    workflow_run_id=workflow_run.id,
                    data=WorkflowAppBlockingResponse.Data(
                        id=workflow_run.id,
                        workflow_id=workflow_run.workflow_id,
                        status=workflow_run.status,
                        outputs=workflow_run.outputs_dict,
                        error=workflow_run.error,
                        elapsed_time=workflow_run.elapsed_time,
                        total_tokens=workflow_run.total_tokens,
                        total_steps=workflow_run.total_steps,
                        created_at=int(workflow_run.created_at.timestamp()),
                        finished_at=int(workflow_run.finished_at.timestamp())
                    )
                )

                return response
            else:
                continue

        raise Exception('Queue listening stopped unexpectedly.')

    def _to_stream_response(self, generator: Generator[StreamResponse, None, None]) \
            -> Generator[WorkflowAppStreamResponse, None, None]:
        """
        To stream response.
        :return:
        """
        for stream_response in generator:
            if not self._task_state.workflow_run:
                raise Exception('Workflow run not found.')

            yield WorkflowAppStreamResponse(
                workflow_run_id=self._task_state.workflow_run.id,
                stream_response=stream_response
            )

    def _listenAudioMsg(self, publisher, task_id: str):
        if not publisher:
            return None
        audio_msg: AudioTrunk = publisher.checkAndGetAudio()
        if audio_msg and audio_msg.status != "finish":
            return MessageAudioStreamResponse(audio=audio_msg.audio, task_id=task_id)
        return None

    def _wrapper_process_stream_response(self, trace_manager: Optional[TraceQueueManager] = None) -> \
            Generator[StreamResponse, None, None]:

        publisher = None
        task_id = self._application_generate_entity.task_id
        tenant_id = self._application_generate_entity.app_config.tenant_id
        features_dict = self._workflow.features_dict

        if features_dict.get('text_to_speech') and features_dict['text_to_speech'].get('enabled') and features_dict[
                'text_to_speech'].get('autoPlay') == 'enabled':
            publisher = AppGeneratorTTSPublisher(tenant_id, features_dict['text_to_speech'].get('voice'))
        for response in self._process_stream_response(publisher=publisher, trace_manager=trace_manager):
            while True:
                audio_response = self._listenAudioMsg(publisher, task_id=task_id)
                if audio_response:
                    yield audio_response
                else:
                    break
            yield response

        start_listener_time = time.time()
        while (time.time() - start_listener_time) < TTS_AUTO_PLAY_TIMEOUT:
            try:
                if not publisher:
                    break
                audio_trunk = publisher.checkAndGetAudio()
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
        yield MessageAudioEndStreamResponse(audio='', task_id=task_id)


    def _process_stream_response(
        self,
        publisher: AppGeneratorTTSPublisher,
        trace_manager: Optional[TraceQueueManager] = None
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response.
        :return:
        """
        for message in self._queue_manager.listen():
            if publisher:
                publisher.publish(message=message)
            event = message.event

            if isinstance(event, QueueErrorEvent):
                err = self._handle_error(event)
                yield self._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                workflow_run = self._handle_workflow_run_start()
                yield self._workflow_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=workflow_run
                )
            elif isinstance(event, QueueNodeStartedEvent):
                workflow_node_execution = self._handle_execution_node_start(event)

                yield self._workflow_node_start_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution
                )
            elif isinstance(event, QueueNodeSucceededEvent | QueueNodeFailedEvent):
                workflow_node_execution = self._handle_node_finished(event)

                yield self._workflow_node_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution
                )

                if isinstance(event, QueueNodeFailedEvent):
                    yield from self._handle_iteration_exception(
                        task_id=self._application_generate_entity.task_id,
                        error=f'Child node failed: {event.error}'
                    )
            elif isinstance(event, QueueIterationStartEvent | QueueIterationNextEvent | QueueIterationCompletedEvent):
                yield self._handle_iteration_to_stream_response(self._application_generate_entity.task_id, event)
                self._handle_iteration_operation(event)
            elif isinstance(event, QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent):
                workflow_run = self._handle_workflow_finished(
                    event, trace_manager=trace_manager
                )

                # save workflow app log
                self._save_workflow_app_log(workflow_run)

                yield self._workflow_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=workflow_run
                )
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                self._task_state.answer += delta_text
                yield self._text_chunk_to_stream_response(delta_text)
            elif isinstance(event, QueueMessageReplaceEvent):
                yield self._text_replace_to_stream_response(event.text)
            elif isinstance(event, QueuePingEvent):
                yield self._ping_stream_response()
            else:
                continue

        if publisher:
            publisher.publish(None)


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

        workflow_app_log = WorkflowAppLog(
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            workflow_id=workflow_run.workflow_id,
            workflow_run_id=workflow_run.id,
            created_from=created_from.value,
            created_by_role=('account' if isinstance(self._user, Account) else 'end_user'),
            created_by=self._user.id,
        )
        db.session.add(workflow_app_log)
        db.session.commit()
        db.session.close()

    def _text_chunk_to_stream_response(self, text: str) -> TextChunkStreamResponse:
        """
        Handle completed event.
        :param text: text
        :return:
        """
        response = TextChunkStreamResponse(
            task_id=self._application_generate_entity.task_id,
            data=TextChunkStreamResponse.Data(text=text)
        )

        return response

    def _text_replace_to_stream_response(self, text: str) -> TextReplaceStreamResponse:
        """
        Text replace to stream response.
        :param text: text
        :return:
        """
        return TextReplaceStreamResponse(
            task_id=self._application_generate_entity.task_id,
            text=TextReplaceStreamResponse.Data(text=text)
        )
