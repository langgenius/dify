"""
Main ResponseStreamCoordinator implementation.

This module contains the public ResponseStreamCoordinator class that manages
response streaming sessions and ensures ordered streaming of responses.
"""

import logging
from collections import deque
from collections.abc import Sequence
from threading import RLock
from typing import Literal, TypeAlias, final
from uuid import uuid4

from pydantic import BaseModel, Field

from core.workflow.enums import NodeExecutionType, NodeState
from core.workflow.graph import Graph
from core.workflow.graph_events import NodeRunStreamChunkEvent, NodeRunSucceededEvent
from core.workflow.nodes.base.template import TextSegment, VariableSegment
from core.workflow.runtime import VariablePool

from .path import Path
from .session import ResponseSession

logger = logging.getLogger(__name__)

# Type definitions
NodeID: TypeAlias = str
EdgeID: TypeAlias = str


class ResponseSessionState(BaseModel):
    """Serializable representation of a response session."""

    node_id: str
    index: int = Field(default=0, ge=0)


class StreamBufferState(BaseModel):
    """Serializable representation of buffered stream chunks."""

    selector: tuple[str, ...]
    events: list[NodeRunStreamChunkEvent] = Field(default_factory=list)


class StreamPositionState(BaseModel):
    """Serializable representation for stream read positions."""

    selector: tuple[str, ...]
    position: int = Field(default=0, ge=0)


class ResponseStreamCoordinatorState(BaseModel):
    """Serialized snapshot of ResponseStreamCoordinator."""

    type: Literal["ResponseStreamCoordinator"] = Field(default="ResponseStreamCoordinator")
    version: str = Field(default="1.0")
    response_nodes: Sequence[str] = Field(default_factory=list)
    active_session: ResponseSessionState | None = None
    waiting_sessions: Sequence[ResponseSessionState] = Field(default_factory=list)
    pending_sessions: Sequence[ResponseSessionState] = Field(default_factory=list)
    node_execution_ids: dict[str, str] = Field(default_factory=dict)
    paths_map: dict[str, list[list[str]]] = Field(default_factory=dict)
    stream_buffers: Sequence[StreamBufferState] = Field(default_factory=list)
    stream_positions: Sequence[StreamPositionState] = Field(default_factory=list)
    closed_streams: Sequence[tuple[str, ...]] = Field(default_factory=list)


@final
class ResponseStreamCoordinator:
    """
    Manages response streaming sessions without relying on global state.

    Ensures ordered streaming of responses based on upstream node outputs and constants.
    """

    def __init__(self, variable_pool: "VariablePool", graph: "Graph") -> None:
        """
        Initialize coordinator with variable pool.

        Args:
            variable_pool: VariablePool instance for accessing node variables
            graph: Graph instance for looking up node information
        """
        self._variable_pool = variable_pool
        self._graph = graph
        self._active_session: ResponseSession | None = None
        self._waiting_sessions: deque[ResponseSession] = deque()
        self._lock = RLock()

        # Internal stream management (replacing OutputRegistry)
        self._stream_buffers: dict[tuple[str, ...], list[NodeRunStreamChunkEvent]] = {}
        self._stream_positions: dict[tuple[str, ...], int] = {}
        self._closed_streams: set[tuple[str, ...]] = set()

        # Track response nodes
        self._response_nodes: set[NodeID] = set()

        # Store paths for each response node
        self._paths_maps: dict[NodeID, list[Path]] = {}

        # Track node execution IDs and types for proper event forwarding
        self._node_execution_ids: dict[NodeID, str] = {}  # node_id -> execution_id

        # Track response sessions to ensure only one per node
        self._response_sessions: dict[NodeID, ResponseSession] = {}  # node_id -> session

    def register(self, response_node_id: NodeID) -> None:
        with self._lock:
            if response_node_id in self._response_nodes:
                return
            self._response_nodes.add(response_node_id)

            # Build and save paths map for this response node
            paths_map = self._build_paths_map(response_node_id)
            self._paths_maps[response_node_id] = paths_map

            # Create and store response session for this node
            response_node = self._graph.nodes[response_node_id]
            session = ResponseSession.from_node(response_node)
            self._response_sessions[response_node_id] = session

    def track_node_execution(self, node_id: NodeID, execution_id: str) -> None:
        """Track the execution ID for a node when it starts executing.

        Args:
            node_id: The ID of the node
            execution_id: The execution ID from NodeRunStartedEvent
        """
        with self._lock:
            self._node_execution_ids[node_id] = execution_id

    def _get_or_create_execution_id(self, node_id: NodeID) -> str:
        """Get the execution ID for a node, creating one if it doesn't exist.

        Args:
            node_id: The ID of the node

        Returns:
            The execution ID for the node
        """
        with self._lock:
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
        root_node_id = self._graph.root_node.id

        # If root is the response node, return empty path
        if root_node_id == response_node_id:
            return [Path()]

        # Extract variable selectors from the response node's template
        response_node = self._graph.nodes[response_node_id]
        response_session = ResponseSession.from_node(response_node)
        template = response_session.template

        # Collect all variable selectors from the template
        variable_selectors: set[tuple[str, ...]] = set()
        for segment in template.segments:
            if isinstance(segment, VariableSegment):
                variable_selectors.add(tuple(segment.selector[:2]))

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
            outgoing_edges = self._graph.get_outgoing_edges(current_node_id)
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

        # Step 2: For each complete path, filter edges based on node blocking behavior
        filtered_paths: list[Path] = []
        for path in all_complete_paths:
            blocking_edges: list[str] = []
            for edge_id in path:
                edge = self._graph.edges[edge_id]
                source_node = self._graph.nodes[edge.tail]

                # Check if node is a branch, container, or response node
                if source_node.execution_type in {
                    NodeExecutionType.BRANCH,
                    NodeExecutionType.CONTAINER,
                    NodeExecutionType.RESPONSE,
                } or source_node.blocks_variable_output(variable_selectors):
                    blocking_edges.append(edge_id)

            # Keep the path even if it's empty
            filtered_paths.append(Path(edges=blocking_edges))

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

        with self._lock:
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

        if self._active_session is None:
            self._active_session = session

            # Try to flush immediately
            events.extend(self.try_flush())
        else:
            # Queue the session if another is active
            self._waiting_sessions.append(session)

        return events

    def intercept_event(
        self, event: NodeRunStreamChunkEvent | NodeRunSucceededEvent
    ) -> Sequence[NodeRunStreamChunkEvent]:
        with self._lock:
            if isinstance(event, NodeRunStreamChunkEvent):
                self._append_stream_chunk(event.selector, event)
                if event.is_final:
                    self._close_stream(event.selector)
                return self.try_flush()
            else:
                # Skip cause we share the same variable pool.
                #
                # for variable_name, variable_value in event.node_run_result.outputs.items():
                #     self._variable_pool.add((event.node_id, variable_name), variable_value)
                return self.try_flush()

    def _create_stream_chunk_event(
        self,
        node_id: str,
        execution_id: str,
        selector: Sequence[str],
        chunk: str,
        is_final: bool = False,
    ) -> NodeRunStreamChunkEvent:
        """Create a stream chunk event with consistent structure.

        For selectors with special prefixes (sys, env, conversation), we use the
        active response node's information since these are not actual node IDs.
        """
        # Check if this is a special selector that doesn't correspond to a node
        if selector and selector[0] not in self._graph.nodes and self._active_session:
            # Use the active response node for special selectors
            response_node = self._graph.nodes[self._active_session.node_id]
            return NodeRunStreamChunkEvent(
                id=execution_id,
                node_id=response_node.id,
                node_type=response_node.node_type,
                selector=selector,
                chunk=chunk,
                is_final=is_final,
            )

        # Standard case: selector refers to an actual node
        node = self._graph.nodes[node_id]
        return NodeRunStreamChunkEvent(
            id=execution_id,
            node_id=node.id,
            node_type=node.node_type,
            selector=selector,
            chunk=chunk,
            is_final=is_final,
        )

    def _process_variable_segment(self, segment: VariableSegment) -> tuple[Sequence[NodeRunStreamChunkEvent], bool]:
        """Process a variable segment. Returns (events, is_complete).

        Handles both regular node selectors and special system selectors (sys, env, conversation).
        For special selectors, we attribute the output to the active response node.
        """
        events: list[NodeRunStreamChunkEvent] = []
        source_selector_prefix = segment.selector[0] if segment.selector else ""
        is_complete = False

        # Determine which node to attribute the output to
        # For special selectors (sys, env, conversation), use the active response node
        # For regular selectors, use the source node
        if self._active_session and source_selector_prefix not in self._graph.nodes:
            # Special selector - use active response node
            output_node_id = self._active_session.node_id
        else:
            # Regular node selector
            output_node_id = source_selector_prefix
        execution_id = self._get_or_create_execution_id(output_node_id)

        # Stream all available chunks
        while self._has_unread_stream(segment.selector):
            if event := self._pop_stream_chunk(segment.selector):
                # For special selectors, we need to update the event to use
                # the active response node's information
                if self._active_session and source_selector_prefix not in self._graph.nodes:
                    response_node = self._graph.nodes[self._active_session.node_id]
                    # Create a new event with the response node's information
                    # but keep the original selector
                    updated_event = NodeRunStreamChunkEvent(
                        id=execution_id,
                        node_id=response_node.id,
                        node_type=response_node.node_type,
                        selector=event.selector,  # Keep original selector
                        chunk=event.chunk,
                        is_final=event.is_final,
                    )
                    events.append(updated_event)
                else:
                    # Regular node selector - use event as is
                    events.append(event)

        # Check if this is the last chunk by looking ahead
        stream_closed = self._is_stream_closed(segment.selector)
        # Check if stream is closed to determine if segment is complete
        if stream_closed:
            is_complete = True

        elif value := self._variable_pool.get(segment.selector):
            # Process scalar value
            is_last_segment = bool(
                self._active_session and self._active_session.index == len(self._active_session.template.segments) - 1
            )
            events.append(
                self._create_stream_chunk_event(
                    node_id=output_node_id,
                    execution_id=execution_id,
                    selector=segment.selector,
                    chunk=value.markdown,
                    is_final=is_last_segment,
                )
            )
            is_complete = True

        return events, is_complete

    def _process_text_segment(self, segment: TextSegment) -> Sequence[NodeRunStreamChunkEvent]:
        """Process a text segment. Returns (events, is_complete)."""
        assert self._active_session is not None
        current_response_node = self._graph.nodes[self._active_session.node_id]

        # Use get_or_create_execution_id to ensure we have a consistent ID
        execution_id = self._get_or_create_execution_id(current_response_node.id)

        is_last_segment = self._active_session.index == len(self._active_session.template.segments) - 1
        event = self._create_stream_chunk_event(
            node_id=current_response_node.id,
            execution_id=execution_id,
            selector=[current_response_node.id, "answer"],  # FIXME(-LAN-)
            chunk=segment.text,
            is_final=is_last_segment,
        )
        return [event]

    def try_flush(self) -> list[NodeRunStreamChunkEvent]:
        with self._lock:
            if not self._active_session:
                return []

            template = self._active_session.template
            response_node_id = self._active_session.node_id

            events: list[NodeRunStreamChunkEvent] = []

            # Process segments sequentially from current index
            while self._active_session.index < len(template.segments):
                segment = template.segments[self._active_session.index]

                if isinstance(segment, VariableSegment):
                    # Check if the source node for this variable is skipped
                    # Only check for actual nodes, not special selectors (sys, env, conversation)
                    source_selector_prefix = segment.selector[0] if segment.selector else ""
                    if source_selector_prefix in self._graph.nodes:
                        source_node = self._graph.nodes[source_selector_prefix]

                        if source_node.state == NodeState.SKIPPED:
                            # Skip this variable segment if the source node is skipped
                            self._active_session.index += 1
                            continue

                    segment_events, is_complete = self._process_variable_segment(segment)
                    events.extend(segment_events)

                    # Only advance index if this variable segment is complete
                    if is_complete:
                        self._active_session.index += 1
                    else:
                        # Wait for more data
                        break

                else:
                    segment_events = self._process_text_segment(segment)
                    events.extend(segment_events)
                    self._active_session.index += 1

            if self._active_session.is_complete():
                # End current session and get events from starting next session
                next_session_events = self.end_session(response_node_id)
                events.extend(next_session_events)

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
        with self._lock:
            events: list[NodeRunStreamChunkEvent] = []

            if self._active_session and self._active_session.node_id == node_id:
                self._active_session = None

                # Try to start next waiting session
                if self._waiting_sessions:
                    next_session = self._waiting_sessions.popleft()
                    self._active_session = next_session

                    # Immediately try to flush any available segments
                    events = self.try_flush()

            return events

    # ============= Internal Stream Management Methods =============

    def _append_stream_chunk(self, selector: Sequence[str], event: NodeRunStreamChunkEvent) -> None:
        """
        Append a stream chunk to the internal buffer.

        Args:
            selector: List of strings identifying the stream location
            event: The NodeRunStreamChunkEvent to append

        Raises:
            ValueError: If the stream is already closed
        """
        key = tuple(selector)

        if key in self._closed_streams:
            raise ValueError(f"Stream {'.'.join(selector)} is already closed")

        if key not in self._stream_buffers:
            self._stream_buffers[key] = []
            self._stream_positions[key] = 0

        self._stream_buffers[key].append(event)

    def _pop_stream_chunk(self, selector: Sequence[str]) -> NodeRunStreamChunkEvent | None:
        """
        Pop the next unread stream chunk from the buffer.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            The next event, or None if no unread events available
        """
        key = tuple(selector)

        if key not in self._stream_buffers:
            return None

        position = self._stream_positions.get(key, 0)
        buffer = self._stream_buffers[key]

        if position >= len(buffer):
            return None

        event = buffer[position]
        self._stream_positions[key] = position + 1
        return event

    def _has_unread_stream(self, selector: Sequence[str]) -> bool:
        """
        Check if the stream has unread events.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            True if there are unread events, False otherwise
        """
        key = tuple(selector)

        if key not in self._stream_buffers:
            return False

        position = self._stream_positions.get(key, 0)
        return position < len(self._stream_buffers[key])

    def _close_stream(self, selector: Sequence[str]) -> None:
        """
        Mark a stream as closed (no more chunks can be appended).

        Args:
            selector: List of strings identifying the stream location
        """
        key = tuple(selector)
        self._closed_streams.add(key)

    def _is_stream_closed(self, selector: Sequence[str]) -> bool:
        """
        Check if a stream is closed.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            True if the stream is closed, False otherwise
        """
        key = tuple(selector)
        return key in self._closed_streams

    def _serialize_session(self, session: ResponseSession | None) -> ResponseSessionState | None:
        """Convert an in-memory session into its serializable form."""

        if session is None:
            return None
        return ResponseSessionState(node_id=session.node_id, index=session.index)

    def _session_from_state(self, session_state: ResponseSessionState) -> ResponseSession:
        """Rebuild a response session from serialized data."""

        node = self._graph.nodes.get(session_state.node_id)
        if node is None:
            raise ValueError(f"Unknown response node '{session_state.node_id}' in serialized state")

        session = ResponseSession.from_node(node)
        session.index = session_state.index
        return session

    def dumps(self) -> str:
        """Serialize coordinator state to JSON."""

        with self._lock:
            state = ResponseStreamCoordinatorState(
                response_nodes=sorted(self._response_nodes),
                active_session=self._serialize_session(self._active_session),
                waiting_sessions=[
                    session_state
                    for session in list(self._waiting_sessions)
                    if (session_state := self._serialize_session(session)) is not None
                ],
                pending_sessions=[
                    session_state
                    for _, session in sorted(self._response_sessions.items())
                    if (session_state := self._serialize_session(session)) is not None
                ],
                node_execution_ids=dict(sorted(self._node_execution_ids.items())),
                paths_map={
                    node_id: [path.edges.copy() for path in paths]
                    for node_id, paths in sorted(self._paths_maps.items())
                },
                stream_buffers=[
                    StreamBufferState(
                        selector=selector,
                        events=[event.model_copy(deep=True) for event in events],
                    )
                    for selector, events in sorted(self._stream_buffers.items())
                ],
                stream_positions=[
                    StreamPositionState(selector=selector, position=position)
                    for selector, position in sorted(self._stream_positions.items())
                ],
                closed_streams=sorted(self._closed_streams),
            )
            return state.model_dump_json()

    def loads(self, data: str) -> None:
        """Restore coordinator state from JSON."""

        state = ResponseStreamCoordinatorState.model_validate_json(data)

        if state.type != "ResponseStreamCoordinator":
            raise ValueError(f"Invalid serialized data type: {state.type}")

        if state.version != "1.0":
            raise ValueError(f"Unsupported serialized version: {state.version}")

        with self._lock:
            self._response_nodes = set(state.response_nodes)
            self._paths_maps = {
                node_id: [Path(edges=list(path_edges)) for path_edges in paths]
                for node_id, paths in state.paths_map.items()
            }
            self._node_execution_ids = dict(state.node_execution_ids)

            self._stream_buffers = {
                tuple(buffer.selector): [event.model_copy(deep=True) for event in buffer.events]
                for buffer in state.stream_buffers
            }
            self._stream_positions = {
                tuple(position.selector): position.position for position in state.stream_positions
            }
            for selector in self._stream_buffers:
                self._stream_positions.setdefault(selector, 0)

            self._closed_streams = {tuple(selector) for selector in state.closed_streams}

            self._waiting_sessions = deque(
                self._session_from_state(session_state) for session_state in state.waiting_sessions
            )
            self._response_sessions = {
                session_state.node_id: self._session_from_state(session_state)
                for session_state in state.pending_sessions
            }
            self._active_session = self._session_from_state(state.active_session) if state.active_session else None
