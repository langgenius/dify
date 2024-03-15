import logging
from collections.abc import Generator
from typing import Any, Union

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueErrorEvent,
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
    TextChunkStreamResponse,
    TextReplaceStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
    WorkflowTaskState,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.workflow_cycle_manage import WorkflowCycleManage
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

        self._workflow = workflow
        self._workflow_system_variables = {
            SystemVariable.FILES: application_generate_entity.files,
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

        if self._stream:
            generator = self._process_stream_response()
            for stream_response in generator:
                yield WorkflowAppStreamResponse(
                    workflow_run_id=self._task_state.workflow_run_id,
                    stream_response=stream_response
                )
        else:
            return self._process_blocking_response()

    def _process_blocking_response(self) -> WorkflowAppBlockingResponse:
        """
        Process blocking response.
        :return:
        """
        for queue_message in self._queue_manager.listen():
            event = queue_message.event

            if isinstance(event, QueueErrorEvent):
                err = self._handle_error(event)
                raise err
            elif isinstance(event, QueueWorkflowStartedEvent):
                self._handle_workflow_start()
            elif isinstance(event, QueueNodeStartedEvent):
                self._handle_node_start(event)
            elif isinstance(event, QueueNodeSucceededEvent | QueueNodeFailedEvent):
                self._handle_node_finished(event)
            elif isinstance(event, QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent):
                workflow_run = self._handle_workflow_finished(event)

                # handle output moderation
                output_moderation_answer = self._handle_output_moderation_when_task_finished(self._task_state.answer)
                if output_moderation_answer:
                    self._task_state.answer = output_moderation_answer

                # save workflow app log
                self._save_workflow_app_log(workflow_run)

                return self._to_blocking_response(workflow_run)
            else:
                continue

        raise Exception('Queue listening stopped unexpectedly.')

    def _to_blocking_response(self, workflow_run: WorkflowRun) -> WorkflowAppBlockingResponse:
        """
        To blocking response.
        :param workflow_run: workflow run
        :return:
        """
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

    def _process_stream_response(self) -> Generator:
        """
        Process stream response.
        :return:
        """
        for message in self._queue_manager.listen():
            event = message.event

            if isinstance(event, QueueErrorEvent):
                err = self._handle_error(event)
                yield self._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                workflow_run = self._handle_workflow_start()
                yield self._workflow_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=workflow_run
                )
            elif isinstance(event, QueueNodeStartedEvent):
                workflow_node_execution = self._handle_node_start(event)
                yield self._workflow_node_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution
                )
            elif isinstance(event, QueueNodeSucceededEvent | QueueNodeFailedEvent):
                workflow_node_execution = self._handle_node_finished(event)
                yield self._workflow_node_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution
                )
            elif isinstance(event, QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent):
                workflow_run = self._handle_workflow_finished(event)

                output_moderation_answer = self._handle_output_moderation_when_task_finished(self._task_state.answer)
                if output_moderation_answer:
                    yield self._text_replace_to_stream_response(output_moderation_answer)

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

                # handle output moderation chunk
                should_direct_answer = self._handle_output_moderation_chunk(delta_text)
                if should_direct_answer:
                    continue

                self._task_state.answer += delta_text
                yield self._text_chunk_to_stream_response(delta_text)
            elif isinstance(event, QueueMessageReplaceEvent):
                yield self._text_replace_to_stream_response(event.text)
            elif isinstance(event, QueuePingEvent):
                yield self._ping_stream_response()
            else:
                continue

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
                    QueueTextChunkEvent(
                        text=self._task_state.answer
                    ), PublishFrom.TASK_PIPELINE
                )

                self._queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION),
                    PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self._output_moderation_handler.append_new_token(text)

        return False
