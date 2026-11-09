"""Frame-local graph scheduling, traversal, and execution tracking."""

from collections.abc import Sequence
from typing import TypedDict, final

from graphon.engine_events.traversal import GraphEdgeSkippedEvent, GraphEdgeTakenEvent
from graphon.enums import NodeExecutionType, NodeState
from graphon.graph.edge import Edge
from graphon.graph.graph import Graph
from graphon.runtime.ready_queue import ReadyTask, StartTask
from graphon.runtime.runtime_state import RuntimeState

type GraphTraversalEvent = GraphEdgeTakenEvent | GraphEdgeSkippedEvent


class _EdgeStateAnalysis(TypedDict):
    """Analysis result for edge states."""

    has_unknown: bool
    has_taken: bool
    all_skipped: bool


@final
class Scheduler:
    def __init__(
        self,
        graph: Graph,
        state: RuntimeState,
        frame_id: str,
    ) -> None:
        """Initialize frame-local scheduling and traversal state.

        Args:
            graph: The workflow graph
            state: Runtime state owning ready task queues
            frame_id: Execution frame managed by this instance

        """
        self._graph = graph
        self._state = state
        self._frame_id = frame_id
        self._unfinished_nodes: set[str] = set()

    # ============= Node State Operations =============

    def enqueue_node(self, node_id: str) -> None:
        """Mark a node as TAKEN and add its task to the ready queue.

        This combines the state transition and enqueueing operations
        that always occur together when preparing a node for execution.

        Args:
            node_id: The ID of the node to enqueue

        """
        self._graph.nodes[node_id].state = NodeState.TAKEN
        self._unfinished_nodes.add(node_id)
        self._state.enqueue_ready_task(
            StartTask(frame_id=self._frame_id, node_id=node_id),
        )

    def mark_node_skipped(self, node_id: str) -> None:
        """Mark a node as SKIPPED.

        Args:
            node_id: The ID of the node to skip

        """
        self._graph.nodes[node_id].state = NodeState.SKIPPED

    def is_node_ready(self, node_id: str) -> bool:
        """Check if a node is ready to be executed.

        A node is ready when all its incoming edges from taken branches
        have been satisfied.

        Args:
            node_id: The ID of the node to check

        Returns:
            True if the node is ready for execution

        """
        incoming_edges = self._graph.get_incoming_edges(node_id)
        if not incoming_edges:
            return True
        if any(edge.state == NodeState.UNKNOWN for edge in incoming_edges):
            return False
        return any(edge.state == NodeState.TAKEN for edge in incoming_edges)

    # ============= Edge State Operations =============

    def mark_edge_taken(self, edge_id: str) -> None:
        """Mark an edge as TAKEN.

        Args:
            edge_id: The ID of the edge to mark

        """
        self._graph.edges[edge_id].state = NodeState.TAKEN

    def mark_edge_skipped(self, edge_id: str) -> None:
        """Mark an edge as SKIPPED.

        Args:
            edge_id: The ID of the edge to mark

        """
        self._graph.edges[edge_id].state = NodeState.SKIPPED

    def analyze_edge_states(self, edges: list[Edge]) -> _EdgeStateAnalysis:
        """Analyze the states of edges and return summary flags.

        Args:
            edges: List of edges to analyze

        Returns:
            Analysis result with state flags

        """
        states = {edge.state for edge in edges}
        return _EdgeStateAnalysis(
            has_unknown=NodeState.UNKNOWN in states,
            has_taken=NodeState.TAKEN in states,
            all_skipped=(states == frozenset((NodeState.SKIPPED,)) if states else True),
        )

    def categorize_branch_edges(
        self,
        node_id: str,
        selected_handle: str,
    ) -> tuple[Sequence[Edge], Sequence[Edge]]:
        """Categorize branch edges into selected and unselected.

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle of the selected edge

        Returns:
            A tuple of (selected_edges, unselected_edges)

        """
        outgoing_edges = self._graph.get_outgoing_edges(node_id)
        selected_edges: list[Edge] = []
        unselected_edges: list[Edge] = []
        for edge in outgoing_edges:
            if edge.source_handle == selected_handle:
                selected_edges.append(edge)
            else:
                unselected_edges.append(edge)
        return selected_edges, unselected_edges

    # ============= Execution Tracking Operations =============

    def track_unfinished(self, node_id: str) -> None:
        """Restore an unfinished node to this frame's execution tracking.

        Args:
            node_id: The ID of the unfinished node

        Raises:
            KeyError: If persisted state references a node outside this frame.

        """
        if node_id not in self._graph.nodes:
            msg = f"Cannot restore unknown node {node_id!r} in frame {self._frame_id!r}"
            raise KeyError(msg)
        self._unfinished_nodes.add(node_id)

    def finish_execution(self, node_id: str) -> None:
        """Mark a node as no longer pending or running.

        Args:
            node_id: The ID of the node finishing execution

        """
        self._unfinished_nodes.discard(node_id)

    # ============= Composite Operations =============

    def is_execution_complete(self) -> bool:
        """Check if this frame's execution is complete.

        Tasks are marked executing when they are enqueued, so this frame is
        complete when no task in this manager remains pending or running.

        Returns:
            True if execution is complete

        """
        return not self._unfinished_nodes

    def defer_ready_tasks(self, tasks: Sequence[ReadyTask]) -> None:
        """Move tasks that have not started into deferred storage."""
        for task in tasks:
            self._state.defer_ready_task(task)

    def process_node_success(
        self,
        node_id: str,
        selected_handle: str | None = None,
    ) -> tuple[Sequence[str], Sequence[GraphTraversalEvent]]:
        """Advance this frame after a node succeeds.

        Branch nodes follow only the selected handle and propagate skipped
        paths. Other nodes take every outgoing edge. The returned node IDs are
        ready to be enqueued, while the returned events describe every edge
        transition in traversal order.

        Args:
            node_id: ID of the node that completed successfully.
            selected_handle: Selected branch handle for branch nodes.

        Returns:
            Ready downstream node IDs and their edge traversal events.

        """
        node = self._graph.nodes[node_id]
        if node.execution_type == NodeExecutionType.BRANCH:
            return self.handle_branch_completion(node_id, selected_handle)
        return self._process_taken_edges(self._graph.get_outgoing_edges(node_id))

    def _process_taken_edges(
        self,
        edges: Sequence[Edge],
    ) -> tuple[list[str], list[GraphEdgeTakenEvent]]:
        """Take each edge and collect downstream nodes that become ready.

        Args:
            edges: Outgoing edges selected by the completed node.

        Returns:
            Ready downstream node IDs and emitted taken-edge events.

        """
        ready_nodes: list[str] = []
        traversal_events: list[GraphEdgeTakenEvent] = []
        for edge in edges:
            nodes, events = self._process_taken_edge(edge)
            ready_nodes.extend(nodes)
            traversal_events.extend(events)
        return ready_nodes, traversal_events

    def _process_taken_edge(
        self,
        edge: Edge,
    ) -> tuple[Sequence[str], Sequence[GraphEdgeTakenEvent]]:
        """Take one edge and report whether its target is ready.

        Args:
            edge: Edge whose state should transition to ``TAKEN``.

        Returns:
            The target node when ready and the corresponding traversal event.

        """
        self.mark_edge_taken(edge.id)
        ready_nodes = [edge.head] if self.is_node_ready(edge.head) else []
        return ready_nodes, [self._build_taken_event(edge)]

    def handle_branch_completion(
        self,
        node_id: str,
        selected_handle: str | None,
    ) -> tuple[Sequence[str], Sequence[GraphTraversalEvent]]:
        """Advance a branch node along its selected path.

        The selected edges are taken and every unselected path is propagated as
        skipped. A missing selection is invalid because the scheduler cannot
        infer which branch should run.

        Args:
            node_id: ID of the completed branch node.
            selected_handle: Handle selected by the branch result.

        Returns:
            Ready downstream node IDs and all resulting traversal events.

        Raises:
            ValueError: If the branch completed without a selected handle.

        """
        if not selected_handle:
            msg = f"Branch node {node_id} completed without selecting a branch"
            raise ValueError(msg)

        selected_edges, unselected_edges = self.categorize_branch_edges(
            node_id,
            selected_handle,
        )
        skipped_events = self._skip_branch_paths(unselected_edges)
        ready_nodes, taken_events = self._process_taken_edges(selected_edges)
        return ready_nodes, [*skipped_events, *taken_events]

    def _skip_branch_paths(
        self,
        unselected_edges: Sequence[Edge],
    ) -> list[GraphEdgeSkippedEvent]:
        """Skip every path beginning with an unselected branch edge.

        Args:
            unselected_edges: Branch edges not selected by the node result.

        Returns:
            Skipped-edge events in graph traversal order.

        """
        events: list[GraphEdgeSkippedEvent] = []
        for edge in unselected_edges:
            events.extend(self._skip_edge_path(edge))
        return events

    def _skip_edge_path(self, edge: Edge) -> list[GraphEdgeSkippedEvent]:
        """Skip one edge and propagate its effect through the target path.

        Args:
            edge: Edge whose state should transition to ``SKIPPED``.

        Returns:
            This edge's event followed by downstream skipped-edge events.

        """
        self.mark_edge_skipped(edge.id)
        return [
            self._build_skipped_event(edge),
            *self._propagate_skip_from_edge(edge.id),
        ]

    def _propagate_skip_from_edge(self, edge_id: str) -> list[GraphEdgeSkippedEvent]:
        """Resolve the target node after one incoming edge is skipped.

        Propagation waits while another incoming edge remains unknown. A taken
        incoming edge makes the target executable; otherwise an entirely
        skipped input set skips the target and continues through its outputs.

        Args:
            edge_id: ID of the edge that was just skipped.

        Returns:
            Additional skipped-edge events produced downstream.

        """
        downstream_node_id = self._graph.edges[edge_id].head
        incoming_edges = self._graph.get_incoming_edges(downstream_node_id)
        edge_states = self.analyze_edge_states(incoming_edges)

        if edge_states["has_unknown"]:
            return []
        if edge_states["has_taken"]:
            self.enqueue_node(downstream_node_id)
            return []
        if edge_states["all_skipped"]:
            return self._propagate_skip_to_node(downstream_node_id)
        return []

    def _propagate_skip_to_node(self, node_id: str) -> list[GraphEdgeSkippedEvent]:
        """Skip a node and recursively skip each of its outgoing paths.

        Args:
            node_id: ID of the node whose inputs are all skipped.

        Returns:
            Skipped-edge events produced from the node's outgoing edges.

        """
        self.mark_node_skipped(node_id)
        events: list[GraphEdgeSkippedEvent] = []
        for edge in self._graph.get_outgoing_edges(node_id):
            events.extend(self._skip_edge_path(edge))
        return events

    def _build_taken_event(self, edge: Edge) -> GraphEdgeTakenEvent:
        """Build the public traversal event for an edge marked as taken.

        Edge IDs are unique only inside one graph. The scheduler owns the
        frame executing that graph, so it adds the frame ID as a separate
        field instead of encoding both identities into one string.

        Args:
            edge: Taken graph edge to describe.

        Returns:
            An event containing the edge identity, endpoints, and source handle.

        """
        return GraphEdgeTakenEvent(
            frame_id=self._frame_id,
            edge_id=edge.id,
            source_node_id=edge.tail,
            target_node_id=edge.head,
            source_handle=edge.source_handle,
        )

    def _build_skipped_event(self, edge: Edge) -> GraphEdgeSkippedEvent:
        """Build the public traversal event for an edge marked as skipped.

        Edge IDs are unique only inside one graph. The scheduler owns the
        frame executing that graph, so it adds the frame ID as a separate
        field instead of encoding both identities into one string.

        Args:
            edge: Skipped graph edge to describe.

        Returns:
            An event containing the edge identity, endpoints, and source handle.

        """
        return GraphEdgeSkippedEvent(
            frame_id=self._frame_id,
            edge_id=edge.id,
            source_node_id=edge.tail,
            target_node_id=edge.head,
            source_handle=edge.source_handle,
        )
