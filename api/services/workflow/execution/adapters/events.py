import logging
from collections.abc import Callable, Sequence

from pydantic import ValidationError

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.agent_strategy import AgentStrategyInfo
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAgentLogEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
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
    QueueReasoningChunkEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.rag.entities import RetrievalSourceMetadata
from core.workflow.nodes.agent.events import NodeRunAgentLogEvent
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.workflow_run_outputs import project_node_outputs_for_workflow_run
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
from services.workflow.execution.ports import PauseReasonResolver
from tasks.mail_human_input_delivery_task import dispatch_human_input_email_task

logger = logging.getLogger(__name__)


class WorkflowEventPublisher:
    """Translate graph events into application events independently of graph construction."""

    def __init__(
        self,
        queue_manager: AppQueueManager,
        *,
        resolve_pause: PauseReasonResolver,
        notify_pause: Callable[[Sequence[object]], None],
    ) -> None:
        self._queue_manager = queue_manager
        self._resolve_pause = resolve_pause
        self._notify_pause = notify_pause

    @staticmethod
    def _build_agent_strategy_info(event: NodeRunStartedEvent) -> AgentStrategyInfo | None:
        raw_agent_strategy = event.extras.get("agent_strategy")
        if raw_agent_strategy is None:
            return None

        try:
            return AgentStrategyInfo.model_validate(raw_agent_strategy)
        except ValidationError:
            logger.warning("Invalid agent strategy payload for node %s", event.node_id, exc_info=True)
            return None

    def publish(self, workflow_entry: WorkflowEntry, event: GraphEngineEvent):
        """
        Handle event
        :param workflow_entry: workflow entry
        :param event: event
        """
        match event:
            case GraphRunStartedEvent():
                self._publish_event(QueueWorkflowStartedEvent(reason=event.reason))
            case GraphRunSucceededEvent():
                self._publish_event(QueueWorkflowSucceededEvent(outputs=event.outputs))
            case GraphRunPartialSucceededEvent():
                self._publish_event(
                    QueueWorkflowPartialSuccessEvent(outputs=event.outputs, exceptions_count=event.exceptions_count)
                )
            case GraphRunFailedEvent():
                self._publish_event(
                    QueueWorkflowFailedEvent(error=event.error, exceptions_count=event.exceptions_count)
                )
            case GraphRunAbortedEvent():
                self._publish_event(
                    QueueStopEvent(
                        stopped_by=QueueStopEvent.StopBy.USER_MANUAL,
                        reason=event.reason or "Workflow execution aborted",
                    )
                )
            case GraphRunPausedEvent():
                runtime_state = workflow_entry.graph_engine.graph_runtime_state
                paused_nodes = list(
                    dict.fromkeys(reason.node_id for reason in event.reasons if isinstance(reason, HitlRequired))
                )
                enriched_reasons = self._resolve_pause(
                    reasons=event.reasons,
                    variable_pool=runtime_state.variable_pool,
                )
                self._notify_pause(enriched_reasons)
                self._publish_event(
                    QueueWorkflowPausedEvent(
                        reasons=enriched_reasons,
                        outputs=event.outputs,
                        paused_nodes=paused_nodes,
                    )
                )
            case NodeRunHumanInputFormFilledEvent():
                self._publish_event(
                    QueueHumanInputFormFilledEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        rendered_content=event.rendered_content,
                        action_id=event.action_id,
                        action_text=event.action_text,
                        submitted_data=event.submitted_data,
                    )
                )
            case NodeRunHumanInputFormTimeoutEvent():
                self._publish_event(
                    QueueHumanInputFormTimeoutEvent(
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        expiration_time=event.expiration_time,
                    )
                )
            case NodeRunRetryEvent():
                node_run_result = event.node_run_result
                inputs = node_run_result.inputs
                process_data = node_run_result.process_data
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=inputs,
                    outputs=node_run_result.outputs,
                )
                execution_metadata = node_run_result.metadata
                self._publish_event(
                    QueueNodeRetryEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_title=event.node_title,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                        inputs=inputs,
                        process_data=process_data,
                        outputs=outputs,
                        error=event.error,
                        execution_metadata=execution_metadata,
                        retry_index=event.retry_index,
                        provider_type=event.provider_type,
                        provider_id=event.provider_id,
                    )
                )
            case NodeRunStartedEvent():
                self._publish_event(
                    QueueNodeStartedEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_title=event.node_title,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                        agent_strategy=self._build_agent_strategy_info(event),
                        provider_type=event.provider_type,
                        provider_id=event.provider_id,
                    )
                )
            case NodeRunSucceededEvent():
                node_run_result = event.node_run_result
                inputs = node_run_result.inputs
                process_data = node_run_result.process_data
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=inputs,
                    outputs=node_run_result.outputs,
                )
                execution_metadata = node_run_result.metadata
                if event.node_type == BuiltinNodeTypes.ANSWER and (event.in_iteration_id or event.in_loop_id):
                    answer = outputs.get("answer")
                    if isinstance(answer, str) and answer:
                        self._publish_event(
                            QueueTextChunkEvent(
                                text=answer,
                                from_variable_selector=[event.node_id, "answer"],
                                in_iteration_id=event.in_iteration_id,
                                in_loop_id=event.in_loop_id,
                            )
                        )
                self._publish_event(
                    QueueNodeSucceededEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        finished_at=event.finished_at,
                        inputs=inputs,
                        process_data=process_data,
                        outputs=outputs,
                        execution_metadata=execution_metadata,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunFailedEvent():
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=event.node_run_result.inputs,
                    outputs=event.node_run_result.outputs,
                )
                self._publish_event(
                    QueueNodeFailedEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        finished_at=event.finished_at,
                        inputs=event.node_run_result.inputs,
                        process_data=event.node_run_result.process_data,
                        outputs=outputs,
                        error=event.node_run_result.error or "Unknown error",
                        execution_metadata=event.node_run_result.metadata,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunExceptionEvent():
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=event.node_run_result.inputs,
                    outputs=event.node_run_result.outputs,
                )
                self._publish_event(
                    QueueNodeExceptionEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        finished_at=event.finished_at,
                        inputs=event.node_run_result.inputs,
                        process_data=event.node_run_result.process_data,
                        outputs=outputs,
                        error=event.node_run_result.error or "Unknown error",
                        execution_metadata=event.node_run_result.metadata,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunStreamChunkEvent():
                self._publish_event(
                    QueueTextChunkEvent(
                        text=event.chunk,
                        from_variable_selector=list(event.selector),
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunReasoningChunkEvent():
                self._publish_event(
                    QueueReasoningChunkEvent(
                        reasoning=event.chunk,
                        from_node_id=event.node_id,
                        is_final=event.is_final,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunRetrieverResourceEvent():
                self._publish_event(
                    QueueRetrieverResourcesEvent(
                        retriever_resources=[
                            RetrievalSourceMetadata.model_validate(resource) for resource in event.retriever_resources
                        ],
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunAgentLogEvent():
                self._publish_event(
                    QueueAgentLogEvent(
                        id=event.message_id,
                        label=event.label,
                        node_execution_id=event.node_execution_id,
                        parent_id=event.parent_id,
                        error=event.error,
                        status=event.status,
                        data=event.data,
                        metadata=event.metadata,
                        node_id=event.node_id,
                    )
                )
            case NodeRunIterationStartedEvent():
                self._publish_event(
                    QueueIterationStartEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        start_at=event.start_at,
                        node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                        inputs=event.inputs,
                        metadata=event.metadata,
                    )
                )
            case NodeRunIterationNextEvent():
                self._publish_event(
                    QueueIterationNextEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        index=event.index,
                        node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                        output=event.pre_iteration_output,
                    )
                )
            case NodeRunIterationSucceededEvent() | NodeRunIterationFailedEvent():
                self._publish_event(
                    QueueIterationCompletedEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        start_at=event.start_at,
                        node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                        inputs=event.inputs,
                        outputs=event.outputs,
                        metadata=event.metadata,
                        steps=event.steps,
                        error=event.error if isinstance(event, NodeRunIterationFailedEvent) else None,
                    )
                )
            case NodeRunLoopStartedEvent():
                self._publish_event(
                    QueueLoopStartEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        start_at=event.start_at,
                        node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                        inputs=event.inputs,
                        metadata=event.metadata,
                    )
                )
            case NodeRunLoopNextEvent():
                self._publish_event(
                    QueueLoopNextEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        index=event.index,
                        node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                        output=event.pre_loop_output,
                    )
                )
            case NodeRunLoopSucceededEvent() | NodeRunLoopFailedEvent():
                self._publish_event(
                    QueueLoopCompletedEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        start_at=event.start_at,
                        node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                        inputs=event.inputs,
                        outputs=event.outputs,
                        metadata=event.metadata,
                        steps=event.steps,
                        error=event.error if isinstance(event, NodeRunLoopFailedEvent) else None,
                    )
                )

    def _publish_event(self, event: AppQueueEvent):
        self._queue_manager.publish(event, PublishFrom.APPLICATION_MANAGER)


def enqueue_human_input_notifications(reasons: Sequence[object]) -> None:
    for reason in reasons:
        if not isinstance(reason, HumanInputRequired):
            continue
        if not reason.form_id:
            continue
        try:
            dispatch_human_input_email_task.apply_async(
                kwargs={"form_id": reason.form_id, "node_title": reason.node_title},
                queue="mail",
            )
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to enqueue human input email task for form %s", reason.form_id)
