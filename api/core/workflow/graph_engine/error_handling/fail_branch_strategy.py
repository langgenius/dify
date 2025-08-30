"""
Fail branch error strategy implementation.
"""

from typing import final

from core.workflow.enums import ErrorStrategy, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunExceptionEvent, NodeRunFailedEvent
from core.workflow.node_events import NodeRunResult


@final
class FailBranchStrategy:
    """
    Error strategy that continues execution via a fail branch.

    This strategy converts failures to exceptions and routes execution
    through a designated fail-branch edge.
    """

    def handle_error(self, event: NodeRunFailedEvent, graph: Graph, retry_count: int) -> GraphNodeEventBase | None:
        """
        Handle error by taking the fail branch.

        Args:
            event: The failure event
            graph: The workflow graph
            retry_count: Current retry attempt count (unused)

        Returns:
            NodeRunExceptionEvent to continue via fail branch
        """
        outputs = {
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
                edge_source_handle="fail-branch",
                metadata={
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.FAIL_BRANCH,
                },
            ),
            error=event.error,
        )
