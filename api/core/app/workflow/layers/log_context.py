"""GraphEngine layer that manages node_id log context via ContextVars.

This layer tracks ``node_id`` during node execution (set on
``on_node_run_start``, cleared on ``on_node_run_end``).  The
``app_id`` / ``workflow_id`` / ``error_source`` lifecycle is managed by
``WorkflowEntry.run`` directly, which has full control over the try/finally
timing relative to ``logger.exception``.

On ``on_graph_start``, this layer refreshes the ``execution_context``
snapshot so that worker threads inherit the ContextVars that
``WorkflowEntry.run`` set just before starting the graph engine.
"""

from typing import override

from context import IExecutionContext
from core.logging.context import set_node_log_context
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphNodeEventBase
from graphon.nodes.base.node import Node


class WorkflowLogContextLayer(GraphEngineLayer):
    """Manage node_id log context lifecycle during graph execution."""

    def __init__(self, *, execution_context: IExecutionContext | None = None) -> None:
        super().__init__()
        self._execution_context = execution_context

    @override
    def on_graph_start(self) -> None:
        # Refresh the execution context snapshot so that worker threads
        # (started after on_graph_start) inherit the ContextVars that
        # WorkflowEntry.run set before starting the graph engine.
        # Without this, workers would see stale default values because the
        # snapshot was captured in WorkflowEntry.__init__ before run().
        if self._execution_context is not None:
            self._execution_context.refresh_context_vars()

    @override
    def on_node_run_start(self, node: Node) -> None:
        set_node_log_context(node.id)

    @override
    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        set_node_log_context("")

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        _ = event

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        # app_id / workflow_id / error_source are managed by WorkflowEntry.run.
        # node_id is cleared in on_node_run_end after each node.
        _ = error
