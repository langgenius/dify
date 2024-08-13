import logging
import os
from collections.abc import Mapping
from typing import Any, Optional, cast

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.base_app_runner import AppRunner
from core.app.apps.workflow_logging_callback import WorkflowLoggingCallback
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAnnotationReplyEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.moderation.base import ModerationException
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.entities.node_entities import SystemVariable, UserFrom
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    IterationRunFailedEvent,
    IterationRunNextEvent,
    IterationRunStartedEvent,
    IterationRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
    ParallelBranchRunFailedEvent,
    ParallelBranchRunStartedEvent,
    ParallelBranchRunSucceededEvent,
)
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from models.model import App, Conversation, EndUser, Message
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class AdvancedChatAppRunner(AppRunner):
    """
    AdvancedChat Application Runner
    """

    def __init__(
            self,
            application_generate_entity: AdvancedChatAppGenerateEntity,
            queue_manager: AppQueueManager,
            conversation: Conversation,
            message: Message
    ) -> None:
        """
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param conversation: conversation
        :param message: message
        """
        self.application_generate_entity = application_generate_entity
        self.queue_manager = queue_manager
        self.conversation = conversation
        self.message = message

    def run(self) -> None:
        """
        Run application
        :return:
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(AdvancedChatAppConfig, app_config)

        app_record = db.session.query(App).filter(App.id == app_config.app_id).first()
        if not app_record:
            raise ValueError("App not found")

        workflow = self.get_workflow(app_model=app_record, workflow_id=app_config.workflow_id)
        if not workflow:
            raise ValueError("Workflow not initialized")

        inputs = self.application_generate_entity.inputs
        query = self.application_generate_entity.query
        files = self.application_generate_entity.files

        user_id = None
        if self.application_generate_entity.invoke_from in [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API]:
            end_user = db.session.query(EndUser).filter(EndUser.id == self.application_generate_entity.user_id).first()
            if end_user:
                user_id = end_user.session_id
        else:
            user_id = self.application_generate_entity.user_id

        # moderation
        if self.handle_input_moderation(
                app_record=app_record,
                app_generate_entity=self.application_generate_entity,
                inputs=inputs,
                query=query,
                message_id=self.message.id
        ):
            return

        # annotation reply
        if self.handle_annotation_reply(
                app_record=app_record,
                message=self.message,
                query=query,
                app_generate_entity=self.application_generate_entity
        ):
            return

        db.session.close()

        workflow_callbacks: list[WorkflowCallback] = []
        if bool(os.environ.get("DEBUG", 'False').lower() == 'true'):
            workflow_callbacks.append(WorkflowLoggingCallback())

        # RUN WORKFLOW
        workflow_entry = WorkflowEntry(
            workflow=workflow,
            user_id=self.application_generate_entity.user_id,
            user_from=UserFrom.ACCOUNT
            if self.application_generate_entity.invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER]
            else UserFrom.END_USER,
            invoke_from=self.application_generate_entity.invoke_from,
            user_inputs=inputs,
            system_inputs={
                SystemVariable.QUERY: query,
                SystemVariable.FILES: files,
                SystemVariable.CONVERSATION_ID: self.conversation.id,
                SystemVariable.USER_ID: user_id
            },
            call_depth=self.application_generate_entity.call_depth
        )

        generator = workflow_entry.run(
            callbacks=workflow_callbacks,
        )

        for event in generator:
            self._handle_event(workflow_entry, event)

    def _handle_event(self, workflow_entry: WorkflowEntry, event: GraphEngineEvent) -> None:
        """
        Handle event
        :param workflow_entry: workflow entry
        :param event: event
        """
        if isinstance(event, GraphRunStartedEvent):
            self._publish_event(
                QueueWorkflowStartedEvent(
                    graph_runtime_state=workflow_entry.graph_engine.graph_runtime_state
                )
            )
        elif isinstance(event, GraphRunSucceededEvent):
            self._publish_event(
                QueueWorkflowSucceededEvent(outputs=event.outputs)
            )
        elif isinstance(event, GraphRunFailedEvent):
            self._publish_event(
                QueueWorkflowFailedEvent(error=event.error)
            )
        elif isinstance(event, NodeRunStartedEvent):
            self._publish_event(
                QueueNodeStartedEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_data=event.node_data,
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    start_at=event.route_node_state.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    predecessor_node_id=event.predecessor_node_id
                )
            )
        elif isinstance(event, NodeRunSucceededEvent):
            self._publish_event(
                QueueNodeSucceededEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_data=event.node_data,
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    start_at=event.route_node_state.start_at,
                    inputs=event.route_node_state.node_run_result.inputs
                    if event.route_node_state.node_run_result else {},
                    process_data=event.route_node_state.node_run_result.process_data
                    if event.route_node_state.node_run_result else {},
                    outputs=event.route_node_state.node_run_result.outputs
                    if event.route_node_state.node_run_result else {},
                    execution_metadata=event.route_node_state.node_run_result.metadata
                    if event.route_node_state.node_run_result else {},
                )
            )
        elif isinstance(event, NodeRunFailedEvent):
            self._publish_event(
                QueueNodeFailedEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_data=event.node_data,
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    start_at=event.route_node_state.start_at,
                    inputs=event.route_node_state.node_run_result.inputs
                    if event.route_node_state.node_run_result else {},
                    process_data=event.route_node_state.node_run_result.process_data
                    if event.route_node_state.node_run_result else {},
                    outputs=event.route_node_state.node_run_result.outputs
                    if event.route_node_state.node_run_result else {},
                    error=event.route_node_state.node_run_result.error
                    if event.route_node_state.node_run_result
                       and event.route_node_state.node_run_result.error
                    else "Unknown error"
                )
            )
        elif isinstance(event, NodeRunStreamChunkEvent):
            self._publish_event(
                QueueTextChunkEvent(
                    text=event.chunk_content
                )
            )
        elif isinstance(event, NodeRunRetrieverResourceEvent):
            self._publish_event(
                QueueRetrieverResourcesEvent(
                    retriever_resources=event.retriever_resources
                )
            )
        elif isinstance(event, ParallelBranchRunStartedEvent):
            self._publish_event(
                QueueParallelBranchRunStartedEvent(
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id
                )
            )
        elif isinstance(event, ParallelBranchRunSucceededEvent):
            self._publish_event(
                QueueParallelBranchRunStartedEvent(
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id
                )
            )
        elif isinstance(event, ParallelBranchRunFailedEvent):
            self._publish_event(
                QueueParallelBranchRunFailedEvent(
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    error=event.error
                )
            )
        elif isinstance(event, IterationRunStartedEvent):
            self._publish_event(
                QueueIterationStartEvent(
                    node_execution_id=event.iteration_id,
                    node_id=event.iteration_node_id,
                    node_type=event.iteration_node_type,
                    node_data=event.iteration_node_data,
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    start_at=event.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    inputs=event.inputs,
                    predecessor_node_id=event.predecessor_node_id,
                    metadata=event.metadata
                )
            )
        elif isinstance(event, IterationRunNextEvent):
            self._publish_event(
                QueueIterationNextEvent(
                    node_execution_id=event.iteration_id,
                    node_id=event.iteration_node_id,
                    node_type=event.iteration_node_type,
                    node_data=event.iteration_node_data,
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    index=event.index,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    output=event.pre_iteration_output,
                )
            )
        elif isinstance(event, (IterationRunSucceededEvent | IterationRunFailedEvent)):
            self._publish_event(
                QueueIterationCompletedEvent(
                    node_execution_id=event.iteration_id,
                    node_id=event.iteration_node_id,
                    node_type=event.iteration_node_type,
                    node_data=event.iteration_node_data,
                    parallel_id=event.parallel_id,
                    parallel_start_node_id=event.parallel_start_node_id,
                    start_at=event.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    inputs=event.inputs,
                    outputs=event.outputs,
                    metadata=event.metadata,
                    steps=event.steps,
                    error=event.error if isinstance(event, IterationRunFailedEvent) else None
                )
            )

    def get_workflow(self, app_model: App, workflow_id: str) -> Optional[Workflow]:
        """
        Get workflow
        """
        # fetch workflow by workflow_id
        workflow = db.session.query(Workflow).filter(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.id == workflow_id
        ).first()

        # return workflow
        return workflow

    def handle_input_moderation(
            self,
            app_record: App,
            app_generate_entity: AdvancedChatAppGenerateEntity,
            inputs: Mapping[str, Any],
            query: str,
            message_id: str
    ) -> bool:
        """
        Handle input moderation
        :param app_record: app record
        :param app_generate_entity: application generate entity
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :return:
        """
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_generate_entity.app_config.tenant_id,
                app_generate_entity=app_generate_entity,
                inputs=inputs,
                query=query,
                message_id=message_id,
            )
        except ModerationException as e:
            self._complete_with_stream_output(
                text=str(e),
                stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION
            )
            return True

        return False

    def handle_annotation_reply(self, app_record: App,
                                message: Message,
                                query: str,
                                app_generate_entity: AdvancedChatAppGenerateEntity) -> bool:
        """
        Handle annotation reply
        :param app_record: app record
        :param message: message
        :param query: query
        :param app_generate_entity: application generate entity
        """
        # annotation reply
        annotation_reply = self.query_app_annotations_to_reply(
            app_record=app_record,
            message=message,
            query=query,
            user_id=app_generate_entity.user_id,
            invoke_from=app_generate_entity.invoke_from
        )

        if annotation_reply:
            self._publish_event(
                QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id)
            )

            self._complete_with_stream_output(
                text=annotation_reply.content,
                stopped_by=QueueStopEvent.StopBy.ANNOTATION_REPLY
            )
            return True

        return False

    def _complete_with_stream_output(self,
                                     text: str,
                                     stopped_by: QueueStopEvent.StopBy) -> None:
        """
        Direct output
        :param text: text
        :return:
        """
        self._publish_event(
            QueueTextChunkEvent(
                text=text
            )
        )

        self._publish_event(
            QueueStopEvent(stopped_by=stopped_by)
        )

    def _publish_event(self, event: AppQueueEvent) -> None:
        self.queue_manager.publish(
            event,
            PublishFrom.APPLICATION_MANAGER
        )
