"""
ResponseStreamCoordinator - Coordinates streaming output from response nodes

This component manages response streaming sessions and ensures ordered streaming
of responses based on upstream node outputs and constants.
"""

import logging
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass, field
from threading import RLock
from typing import Optional, TypeAlias
from uuid import uuid4

from core.workflow.enums import NodeExecutionType, NodeState
from core.workflow.graph import Graph
from core.workflow.graph_events import NodeRunStreamChunkEvent, NodeRunSucceededEvent
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template, TextSegment, VariableSegment
from core.workflow.nodes.end.end_node import EndNode

from .output_registry import OutputRegistry

logger = logging.getLogger(__name__)

# Type definitions
NodeID: TypeAlias = str
EdgeID: TypeAlias = str


@dataclass
class Path:
    """Represents a path of branch edges that must be taken to reach a response node."""

    edges: list[EdgeID] = field(default_factory=list)

    def contains_edge(self, edge_id: EdgeID) -> bool:
        """Check if this path contains the given edge."""
        return edge_id in self.edges

    def remove_edge(self, edge_id: EdgeID) -> None:
        """Remove the given edge from this path in place."""
        if self.contains_edge(edge_id):
            self.edges.remove(edge_id)

    def is_empty(self) -> bool:
        """Check if the path has no edges (node is reachable)."""
        return len(self.edges) == 0


@dataclass
class ResponseSession:
    """Represents an active response streaming session."""

    node_id: str
    template: Template  # Template object from the response node
    index: int = 0  # Current position in the template segments

    @classmethod
    def from_node(cls, node: Node):
        """
        Create a ResponseSession from an AnswerNode or EndNode.

        Args:
            node: Must be either an AnswerNode or EndNode instance

        Returns:
            ResponseSession configured with the node's streaming template

        Raises:
            TypeError: If node is not an AnswerNode or EndNode
        """
        if not isinstance(node, AnswerNode | EndNode):
            raise TypeError
        return cls(
            node_id=node.id,
            template=node.get_streaming_template(),
        )

    def is_complete(self) -> bool:
        """Check if all segments in the template have been processed."""
        return self.index >= len(self.template.segments)


class ResponseStreamCoordinator:
    """
    Manages response streaming sessions without relying on global state.

    Ensures ordered streaming of responses based on upstream node outputs and constants.
    """

    def __init__(self, registry: OutputRegistry, graph: "Graph") -> None:
        """
        Initialize coordinator with output registry.

        Args:
            registry: OutputRegistry instance for accessing node outputs
            graph: Graph instance for looking up node information
        """
        self.registry = registry
        self.graph = graph
        self.active_session: Optional[ResponseSession] = None
        self.waiting_sessions: deque[ResponseSession] = deque()
        self.lock = RLock()

        # Track response nodes
        self._response_nodes: set[NodeID] = set()

        # Store paths for each response node
        self._paths_maps: dict[NodeID, list[Path]] = {}

        # Track node execution IDs and types for proper event forwarding
        self._node_execution_ids: dict[NodeID, str] = {}  # node_id -> execution_id

        # Track response sessions to ensure only one per node
        self._response_sessions: dict[NodeID, ResponseSession] = {}  # node_id -> session

    def register(self, response_node_id: NodeID) -> None:
        with self.lock:
            self._response_nodes.add(response_node_id)

            # Build and save paths map for this response node
            paths_map = self._build_paths_map(response_node_id)
            self._paths_maps[response_node_id] = paths_map

            # Create and store response session for this node
            response_node = self.graph.nodes[response_node_id]
            session = ResponseSession.from_node(response_node)
            self._response_sessions[response_node_id] = session

    def track_node_execution(self, node_id: NodeID, execution_id: str) -> None:
        """Track the execution ID for a node when it starts executing.

        Args:
            node_id: The ID of the node
            execution_id: The execution ID from NodeRunStartedEvent
        """
        with self.lock:
            self._node_execution_ids[node_id] = execution_id

    def _get_or_create_execution_id(self, node_id: NodeID) -> str:
        """Get the execution ID for a node, creating one if it doesn't exist.

        Args:
            node_id: The ID of the node

        Returns:
            The execution ID for the node
        """
        with self.lock:
            if node_id not in self._node_execution_ids:
                self._node_execution_ids[node_id] = str(uuid4())
            return self._node_execution_ids[node_id]

    def _build_paths_map(self, response_node_id: NodeID) -> list[Path]:
        """
        Build a paths map for a response node by finding all paths from root node
        to the response node, recording branch edges along each path.

        Args:
            response_node_id: ID of the response node to analyze

        Returns:
            List of Path objects, where each path contains branch edge IDs
        """
        # Get root node ID
        root_node_id = self.graph.root_node.id

        # If root is the response node, return empty path
        if root_node_id == response_node_id:
            return [Path()]

        # Step 1: Find all complete paths from root to response node
        all_complete_paths: list[list[EdgeID]] = []

        def find_paths(
            current_node_id: NodeID, target_node_id: NodeID, current_path: list[EdgeID], visited: set[NodeID]
        ) -> None:
            """Recursively find all paths from current node to target node."""
            if current_node_id == target_node_id:
                # Found a complete path, store it
                all_complete_paths.append(current_path.copy())
                return

            # Mark as visited to avoid cycles
            visited.add(current_node_id)

            # Explore outgoing edges
            outgoing_edges = self.graph.get_outgoing_edges(current_node_id)
            for edge in outgoing_edges:
                edge_id = edge.id
                next_node_id = edge.head

                # Skip if already visited in this path
                if next_node_id not in visited:
                    # Add edge to path and recurse
                    new_path = current_path + [edge_id]
                    find_paths(next_node_id, target_node_id, new_path, visited.copy())

        # Start searching from root node
        find_paths(root_node_id, response_node_id, [], set())

        # Step 2: For each complete path, filter to keep only edges from branch nodes
        filtered_paths: list[Path] = []
        for path in all_complete_paths:
            branch_edges = []
            for edge_id in path:
                edge = self.graph.edges[edge_id]
                source_node = self.graph.nodes[edge.tail]
                if source_node.execution_type in {NodeExecutionType.BRANCH, NodeExecutionType.CONTAINER}:
                    branch_edges.append(edge_id)
            # Keep the path even if it's empty
            filtered_paths.append(Path(edges=branch_edges))

        return filtered_paths

    def on_edge_taken(self, edge_id: str) -> Sequence[NodeRunStreamChunkEvent]:
        """
        Handle when an edge is taken (selected by a branch node).

        This method updates the paths for all response nodes by removing
        the taken edge. If any response node has an empty path after removal,
        it means the node is now deterministically reachable and should start.

        Args:
            edge_id: The ID of the edge that was taken

        Returns:
            List of events to emit from starting new sessions
        """
        events: list[NodeRunStreamChunkEvent] = []

        with self.lock:
            # Check each response node in order
            for response_node_id in self._response_nodes:
                if response_node_id not in self._paths_maps:
                    continue

                paths = self._paths_maps[response_node_id]
                has_reachable_path = False

                # Update each path by removing the taken edge
                for path in paths:
                    # Remove the taken edge from this path
                    path.remove_edge(edge_id)

                    # Check if this path is now empty (node is reachable)
                    if path.is_empty():
                        has_reachable_path = True

                # If node is now reachable (has empty path), start/queue session
                if has_reachable_path:
                    # Pass the node_id to the activation method
                    # The method will handle checking and removing from map
                    events.extend(self._active_or_queue_session(response_node_id))

        return events

    def _active_or_queue_session(self, node_id: str) -> Sequence[NodeRunStreamChunkEvent]:
        """
        Start a session immediately if no active session, otherwise queue it.
        Only activates sessions that exist in the _response_sessions map.

        Args:
            node_id: The ID of the response node to activate

        Returns:
            List of events from flush attempt if session started immediately
        """
        events: list[NodeRunStreamChunkEvent] = []

        # Get the session from our map (only activate if it exists)
        session = self._response_sessions.get(node_id)
        if not session:
            return events

        # Remove from map to ensure it won't be activated again
        del self._response_sessions[node_id]

        if self.active_session is None:
            self.active_session = session

            # Try to flush immediately
            events.extend(self.try_flush())
        else:
            # Queue the session if another is active
            self.waiting_sessions.append(session)

        return events

    def intercept_event(
        self, event: NodeRunStreamChunkEvent | NodeRunSucceededEvent
    ) -> Sequence[NodeRunStreamChunkEvent]:
        with self.lock:
            if isinstance(event, NodeRunStreamChunkEvent):
                if event.chunk:
                    self.registry.append_chunk(event.selector, event)
                if event.is_final:
                    self.registry.close_stream(event.selector)
                return self.try_flush()
            elif isinstance(event, NodeRunSucceededEvent):
                for variable_name, variable_value in event.node_run_result.outputs.items():
                    self.registry.set_scalar((event.node_id, variable_name), variable_value)
                return self.try_flush()
        return []

    def _create_stream_chunk_event(
        self,
        node_id: str,
        execution_id: str,
        selector: Sequence[str],
        chunk: str,
        is_final: bool = False,
    ) -> NodeRunStreamChunkEvent:
        """Create a stream chunk event with consistent structure."""
        node = self.graph.nodes[node_id]
        return NodeRunStreamChunkEvent(
            id=execution_id,
            node_id=node.id,
            node_type=node.node_type,
            selector=selector,
            chunk=chunk,
            is_final=is_final,
            # Legacy fields
            chunk_content=chunk,
            from_variable_selector=list(selector),
        )

    def _process_variable_segment(self, segment: VariableSegment) -> tuple[Sequence[NodeRunStreamChunkEvent], bool]:
        """Process a variable segment. Returns (events, is_complete)."""

        events: list[NodeRunStreamChunkEvent] = []
        source_node_id = segment.selector[0]
        is_complete = False

        if self.registry.has_unread(segment.selector):
            # Stream all available chunks
            source_exec_id = self._get_or_create_execution_id(source_node_id)

            # Check if this is the last chunk by looking ahead
            stream_closed = self.registry.stream_closed(segment.selector)

            while self.registry.has_unread(segment.selector):
                if event := self.registry.pop_chunk(segment.selector):
                    # The event already contains all necessary information
                    # We can use it directly in the RSC
                    events.append(event)

            # Check if stream is closed to determine if segment is complete
            if stream_closed:
                is_complete = True

        elif value := self.registry.get_scalar(segment.selector):
            # Process scalar value
            source_exec_id = self._get_or_create_execution_id(source_node_id)

            events.append(
                self._create_stream_chunk_event(
                    node_id=source_node_id,
                    execution_id=source_exec_id,
                    selector=segment.selector,
                    chunk=value.markdown,
                    is_final=True,
                )
            )
            is_complete = True

        return events, is_complete

    def _process_text_segment(self, segment: TextSegment) -> Sequence[NodeRunStreamChunkEvent]:
        """Process a text segment. Returns (events, is_complete)."""
        assert self.active_session is not None
        current_response_node = self.graph.nodes[self.active_session.node_id]

        # Use get_or_create_execution_id to ensure we have a consistent ID
        execution_id = self._get_or_create_execution_id(current_response_node.id)
        event = self._create_stream_chunk_event(
            node_id=current_response_node.id,
            execution_id=execution_id,
            selector=[current_response_node.id, "answer"],  # FIXME(-LAN-)
            chunk=segment.text,
            is_final=True,
        )
        return [event]

    def try_flush(self) -> list[NodeRunStreamChunkEvent]:
        with self.lock:
            if not self.active_session:
                return []

            template = self.active_session.template
            response_node_id = self.active_session.node_id

            events: list[NodeRunStreamChunkEvent] = []

            # Process segments sequentially from current index
            while self.active_session.index < len(template.segments):
                segment = template.segments[self.active_session.index]

                if isinstance(segment, VariableSegment):
                    # Check if the source node for this variable is skipped
                    source_node_id = segment.selector[0]
                    if source_node_id in self.graph.nodes:
                        source_node = self.graph.nodes[source_node_id]

                        if source_node.state == NodeState.SKIPPED:
                            # Skip this variable segment if the source node is skipped
                            self.active_session.index += 1
                            continue

                    segment_events, is_complete = self._process_variable_segment(segment)
                    events.extend(segment_events)

                    # Only advance index if this variable segment is complete
                    if is_complete:
                        self.active_session.index += 1
                    else:
                        # Wait for more data
                        break

                elif isinstance(segment, TextSegment):
                    segment_events = self._process_text_segment(segment)
                    events.extend(segment_events)
                    self.active_session.index += 1

            if self.active_session.is_complete():
                self.end_session(response_node_id)

            return events

    def end_session(self, node_id: str) -> list[NodeRunStreamChunkEvent]:
        """
        End the active session for a response node.
        Automatically starts the next waiting session if available.

        Args:
            node_id: ID of the response node ending its session

        Returns:
            List of events from starting the next session
        """
        with self.lock:
            events: list[NodeRunStreamChunkEvent] = []

            if self.active_session and self.active_session.node_id == node_id:
                self.active_session = None

                # Try to start next waiting session
                if self.waiting_sessions:
                    next_session = self.waiting_sessions.popleft()
                    self.active_session = next_session

                    # Immediately try to flush any available segments
                    events = self.try_flush()

            return events
