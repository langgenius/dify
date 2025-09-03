"""
Default value error strategy implementation.
"""

from typing import final

from core.workflow.enums import ErrorStrategy, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunExceptionEvent, NodeRunFailedEvent
from core.workflow.node_events import NodeRunResult


@final
class DefaultValueStrategy:
    """
    Error strategy that uses default values on failure.

    This strategy allows nodes to fail gracefully by providing
    predefined default output values.
    """

    def handle_error(self, event: NodeRunFailedEvent, graph: Graph, retry_count: int) -> GraphNodeEventBase | None:
        """
        Handle error by using default values.

        Args:
            event: The failure event
            graph: The workflow graph
            retry_count: Current retry attempt count (unused)

        Returns:
            NodeRunExceptionEvent with default values
        """
        _ = retry_count
        node = graph.nodes[event.node_id]

        outputs = {
            **node.default_value_dict,
            "error_message": event.node_run_result.error,
            "error_type": event.node_run_result.error_type,
        }

        return NodeRunExceptionEvent(
            id=event.id,
            node_id=event.node_id,
            node_type=event.node_type,
            start_at=event.start_at,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.EXCEPTION,
                inputs=event.node_run_result.inputs,
                process_data=event.node_run_result.process_data,
                outputs=outputs,
                metadata={
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.DEFAULT_VALUE,
                },
            ),
            error=event.error,
        )
