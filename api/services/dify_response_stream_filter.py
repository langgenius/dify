from collections import deque
from collections.abc import Iterable
from typing import Any, cast

from graphon.enums import BuiltinNodeTypes, ErrorStrategy, NodeExecutionType
from graphon.filters import ResponseStreamFilter
from graphon.graph_events import GraphEdgeSkippedEvent, GraphEngineEvent, NodeRunStreamChunkEvent
from graphon.nodes.base.node import Node


class DifyResponseStreamFilter(ResponseStreamFilter):
    def on_event(self, event: GraphEngineEvent) -> Iterable[GraphEngineEvent]:
        if isinstance(event, NodeRunStreamChunkEvent) and event.chunk:
            node = self._node(event.node_id)
            selector = tuple(event.selector)
            if self._can_stream(node, "source") and selector in self._referenced_selectors:
                released: list[GraphEngineEvent] = []
                for edge_id in self._success_edges(node.id):
                    released.extend(self._handle_streaming_success_edge(edge_id, selector, node))
                return [*released, *super().on_event(event)]

        if isinstance(event, GraphEdgeSkippedEvent):
            edge = self._bound_graph.edges[event.edge_id]
            node = self._node(edge.tail)
            if edge.source_handle == "source" and self._can_stream(node, edge.source_handle):
                return [*self._discard_response_sessions_for(node.id), *super().on_event(event)]

        return super().on_event(event)

    def _node(self, node_id: str) -> Node[Any]:
        return cast(Node[Any], self._bound_graph.nodes[node_id])

    def _can_stream(self, source_node: Node[Any], source_handle: str) -> bool:
        output_routes = getattr(source_node.node_data, "agent_output_routes", None)
        return (
            source_node.error_strategy == ErrorStrategy.FAIL_BRANCH
            and source_node.execution_type == NodeExecutionType.BRANCH
            and type(source_node).execution_type != NodeExecutionType.BRANCH
            and not (source_node.node_type == BuiltinNodeTypes.AGENT and getattr(output_routes, "enabled", False))
            and source_handle == "source"
        )

    def _success_edges(self, node_id: str) -> list[str]:
        return [edge.id for edge in self._bound_graph.get_outgoing_edges(node_id) if edge.source_handle == "source"]

    def _handle_streaming_success_edge(
        self,
        edge_id: str,
        selector: tuple[str, ...],
        source_node: Node[Any],
    ) -> list[GraphEngineEvent]:
        events: list[GraphEngineEvent] = []
        for response_node_id in sorted(self._response_nodes):
            referenced_selectors = self._get_referenced_selectors(response_node_id)
            if selector not in referenced_selectors or source_node.blocks_variable_output(referenced_selectors):
                continue

            paths = self._paths_maps.get(response_node_id)
            if paths is None:
                continue

            has_reachable_path = False
            for path in paths:
                path.remove_edge(edge_id)
                if path.is_empty():
                    has_reachable_path = True

            if has_reachable_path:
                events.extend(self._active_or_queue_session(response_node_id))
        return events

    def _discard_response_sessions_for(self, node_id: str) -> list[GraphEngineEvent]:
        response_node_ids = {
            response_node_id
            for response_node_id in self._response_nodes
            if any(selector[0] == node_id for selector in self._get_referenced_selectors(response_node_id))
        }
        active = self._active_session
        if active is not None and active.node_id in response_node_ids:
            self._active_session = None
        self._waiting_sessions = deque(
            session for session in self._waiting_sessions if session.node_id not in response_node_ids
        )
        if self._active_session is None and self._waiting_sessions:
            self._active_session = self._waiting_sessions.popleft()
        return self._try_flush() if self._active_session is not None else []
