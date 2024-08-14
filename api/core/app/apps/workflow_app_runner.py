from typing import Optional

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueRetrieverResourcesEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
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
from models.model import App
from models.workflow import Workflow


class WorkflowBasedAppRunner(AppRunner):
    def __init__(self, queue_manager: AppQueueManager):
        self.queue_manager = queue_manager

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
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == app_model.tenant_id, Workflow.app_id == app_model.id, Workflow.id == workflow_id
            )
            .first()
        )

        # return workflow
        return workflow
    
    def _publish_event(self, event: AppQueueEvent) -> None:
        self.queue_manager.publish(
            event,
            PublishFrom.APPLICATION_MANAGER
        )
