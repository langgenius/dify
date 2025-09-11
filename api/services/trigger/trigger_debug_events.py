"""
Event generator for trigger debug operations.

Provides structured event generation for trigger debug SSE streams.
"""

from core.app.entities.task_entities import (
    ErrorStreamResponse,
    StreamResponse,
    TriggerDebugNodeFinishedResponse,
    TriggerDebugWorkflowStartedResponse,
)
from core.trigger.entities.entities import TriggerDebugEventData
from models.workflow import WorkflowNodeExecutionModel


class TriggerDebugEventGenerator:
    """Generator for trigger debug events."""

    @staticmethod
    def generate_node_finished(node_execution: WorkflowNodeExecutionModel) -> StreamResponse:
        """Generate node finished event."""
        return TriggerDebugNodeFinishedResponse(
            task_id="",
            id=node_execution.id,
            node_id=node_execution.node_id,
            node_type=node_execution.node_type,
            status=node_execution.status,
            outputs=node_execution.outputs_dict,
            error=node_execution.error,
            elapsed_time=node_execution.elapsed_time,
            execution_metadata=node_execution.execution_metadata_dict,
        )

    @staticmethod
    def generate_workflow_started(event_data: TriggerDebugEventData) -> StreamResponse:
        """Generate workflow started event."""
        return TriggerDebugWorkflowStartedResponse(
            task_id="",
            subscription_id=event_data.subscription_id,
            triggers=event_data.triggers,
            request_id=event_data.request_id,
        )

    @staticmethod
    def generate_error(error: str) -> StreamResponse:
        """Generate error event."""
        return ErrorStreamResponse(task_id="", err=Exception(error))
