from collections.abc import Iterable
from typing import override

from graphon.filters import ResponseStreamFilter
from graphon.graph_events import GraphEngineEvent, NodeRunStreamChunkEvent


class DifyResponseStreamFilter(ResponseStreamFilter):
    """ResponseStreamFilter that supports response nodes inside container nodes.

    Response nodes (answer) placed inside an iteration or loop run in a child
    graph, and the container node forwards their events to the parent engine.
    The base filter registers them from the parent graph config but can never
    activate their streaming sessions — they have no traversal path from the
    parent root — so their output silently disappears from the response stream.

    This subclass leaves child-graph response nodes to the child engine's own
    filter (see ``_WorkflowChildEngineBuilder``) and passes the stream chunks
    the container forwards straight through to the caller.
    """

    @override
    def _register(self, response_node_id: str) -> None:
        # Response nodes with no traversal path from this graph's root live in
        # a container's child graph; the child engine streams them instead.
        root_node_id = self._bound_graph.root_node.id
        if response_node_id != root_node_id and not self._find_all_paths(root_node_id, response_node_id):
            return
        super()._register(response_node_id)

    @override
    def on_event(self, event: GraphEngineEvent) -> Iterable[GraphEngineEvent]:
        if isinstance(event, NodeRunStreamChunkEvent) and (event.in_iteration_id or event.in_loop_id):
            return [event]
        return super().on_event(event)
