import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from pydantic import ValidationError

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.agent_strategy import AgentStrategyInfo
from core.app.entities.queue_entities import (
    AppQueueEvent,
    NodeExecutionSnapshot,
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
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired, PauseReason
from core.workflow.workflow_run_outputs import project_node_outputs_for_workflow_run
from enums.human_input import HumanInputFormStatus
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeEvent,
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
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from graphon.variables.factory import build_segment
from models.human_input_contracts import HumanInputFormRecord
from services.workflow.execution.adapters.human_input import DifyHITLCallback
from services.workflow.execution.contracts import WorkflowRunEntry
from tasks.mail_human_input_delivery_task import dispatch_human_input_email_task

logger = logging.getLogger(__name__)


def _merge_container_metadata(
    lifecycle_metadata: Mapping[str, Any], node_metadata: Mapping[str, Any]
) -> dict[str, Any]:
    # Keep lifecycle details and ancestor ownership together, preserving the
    # existing node-result precedence when both sources contain the same key.
    return {**lifecycle_metadata, **node_metadata}


class WorkflowEventPublisher:
    """Translate engine events into application events independently of graph construction."""

    def __init__(
        self,
        queue_manager: AppQueueManager,
        *,
        notify_pause: Callable[[Sequence[object]], None],
    ) -> None:
        self._queue_manager = queue_manager
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

    def publish_human_input_results(
        self,
        workflow_entry: WorkflowRunEntry,
        pending_forms: Mapping[str, HitlRequired],
        forms: Mapping[str, HumanInputFormRecord],
        published_form_ids: set[str],
    ) -> None:
        """Publish materialized completions supplied by run orchestration."""
        for form_id, reason in pending_forms.items():
            form = forms[form_id]
            node_id = reason.node_id
            node_title = reason.node_title or form.definition.node_title or form.node_id
            if form.status == HumanInputFormStatus.TIMEOUT:
                self._publish_event(
                    QueueHumanInputFormTimeoutEvent(
                        form_id=form_id,
                        node_id=node_id,
                        node_type=BuiltinNodeTypes.HUMAN_INPUT,
                        node_title=node_title,
                        expiration_time=form.expiration_time,
                    )
                )
                published_form_ids.add(form_id)
            elif form.status == HumanInputFormStatus.SUBMITTED:
                action = next(
                    (item for item in form.definition.user_actions if item.id == form.selected_action_id), None
                )
                if action is None:
                    raise ValueError(f"Submitted human input form has no matching action: {form_id}")
                submitted_data = {name: build_segment(value) for name, value in (form.submitted_data or {}).items()}
                self._publish_event(
                    QueueHumanInputFormFilledEvent(
                        form_id=form_id,
                        node_id=node_id,
                        node_type=BuiltinNodeTypes.HUMAN_INPUT,
                        node_title=node_title,
                        rendered_content=DifyHITLCallback.render_form_content_with_outputs(
                            form.rendered_content,
                            submitted_data,
                            [item.output_variable_name for item in form.definition.inputs],
                            form.definition.inputs,
                        ),
                        action_id=action.id,
                        action_text=action.title,
                        submitted_data=submitted_data,
                    )
                )
                published_form_ids.add(form_id)

    def publish(
        self,
        workflow_entry: WorkflowRunEntry,
        event: EngineEvent,
        *,
        node_run_index: int = 1,
        node_execution_snapshots: tuple[NodeExecutionSnapshot, ...] = (),
        pause_reasons: Sequence[PauseReason] = (),
    ) -> None:
        """Publish one engine event with run-owned indexes and resolved pause data."""
        node_metadata: dict[str, Any] = (
            {str(key): value for key, value in event.node_run_result.metadata.items()}
            if isinstance(event, NodeEvent)
            else {}
        )
        iteration_id = node_metadata.get(WorkflowNodeExecutionMetadataKey.ITERATION_ID.value)
        loop_id = node_metadata.get(WorkflowNodeExecutionMetadataKey.LOOP_ID.value)
        match event:
            case NodeRunHumanInputFormFilledEvent():
                self._publish_event(
                    QueueHumanInputFormFilledEvent(
                        form_id=event.id,
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
                        form_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        expiration_time=event.expiration_time,
                    )
                )
            case GraphRunStartedEvent():
                self._publish_event(
                    QueueWorkflowStartedEvent(reason=event.reason, node_execution_snapshots=node_execution_snapshots)
                )
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
                paused_nodes = list(
                    dict.fromkeys(reason.node_id for reason in pause_reasons if isinstance(reason, HumanInputRequired))
                )
                self._notify_pause(pause_reasons)
                self._publish_event(
                    QueueWorkflowPausedEvent(
                        reasons=list(pause_reasons),
                        outputs=event.outputs,
                        paused_nodes=paused_nodes,
                    )
                )
            case NodeRunRetryEvent():
                node_run_result = event.node_run_result
                inputs = node_run_result.inputs
                process_data = node_run_result.process_data
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type, inputs=inputs, outputs=node_run_result.outputs
                )
                self._publish_event(
                    QueueNodeRetryEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_title=event.node_title,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
                        inputs=inputs,
                        process_data=process_data,
                        outputs=outputs,
                        error=event.error,
                        execution_metadata=node_run_result.metadata,
                        retry_index=event.retry_index,
                        provider_type=event.provider_type,
                        provider_id=event.provider_id,
                    )
                )
            case NodeRunStartedEvent():
                self._publish_event(
                    QueueNodeStartedEvent(
                        node_execution_id=event.id,
                        node_run_index=node_run_index,
                        node_id=event.node_id,
                        node_title=event.node_title,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
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
                    node_type=event.node_type, inputs=inputs, outputs=node_run_result.outputs
                )
                if event.node_type == BuiltinNodeTypes.ANSWER and (iteration_id or loop_id):
                    answer = outputs.get("answer")
                    if isinstance(answer, str) and answer:
                        self._publish_event(
                            QueueTextChunkEvent(
                                text=answer,
                                from_variable_selector=[event.node_id, "answer"],
                                in_iteration_id=iteration_id,
                                in_loop_id=loop_id,
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
                        execution_metadata=node_run_result.metadata,
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
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
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
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
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
                    )
                )
            case NodeRunStreamChunkEvent():
                self._publish_event(
                    QueueTextChunkEvent(
                        text=event.chunk,
                        from_variable_selector=list(event.selector),
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
                    )
                )
            case NodeRunReasoningChunkEvent():
                self._publish_event(
                    QueueReasoningChunkEvent(
                        reasoning=event.chunk,
                        from_node_id=event.node_id,
                        is_final=event.is_final,
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
                    )
                )
            case NodeRunRetrieverResourceEvent():
                self._publish_event(
                    QueueRetrieverResourcesEvent(
                        retriever_resources=[
                            RetrievalSourceMetadata.model_validate(resource) for resource in event.retriever_resources
                        ],
                        in_iteration_id=iteration_id,
                        in_loop_id=loop_id,
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
                        inputs=event.inputs,
                        metadata=_merge_container_metadata(event.metadata, node_metadata),
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
                        inputs=event.inputs,
                        outputs=event.outputs,
                        metadata=_merge_container_metadata(event.metadata, node_metadata),
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
                        inputs=event.inputs,
                        metadata=_merge_container_metadata(event.metadata, node_metadata),
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
                        inputs=event.inputs,
                        outputs=event.outputs,
                        metadata=_merge_container_metadata(event.metadata, node_metadata),
                        steps=event.steps,
                        error=event.error if isinstance(event, NodeRunLoopFailedEvent) else None,
                    )
                )

    def _publish_event(self, event: AppQueueEvent) -> None:
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
