from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import cast
from uuid import uuid4

from graphon.engine.filter.protocol import EngineEventFilterContext
from graphon.engine_events.base import EngineEvent
from graphon.engine_events.graph import GraphRunStartedEvent
from graphon.engine_events.node import (
    NodeRunExceptionEvent,
    NodeRunReasoningChunkEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.engine_events.traversal import GraphEdgeSkippedEvent, GraphEdgeTakenEvent
from graphon.enums import NodeExecutionType, NodeState
from graphon.file.protocols import WorkflowFileRuntimeProtocol
from graphon.file.runtime import use_workflow_file_runtime
from graphon.nodes.base.template import Template, TextSegment, VariableSegment
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.runtime.runtime_state import GraphProtocol, NodeProtocol
from graphon.runtime.runtime_state_protocol import ReadOnlyRuntimeState

from . import snapshot, v2
from .snapshot import (
    ResponseSessionState,
    ResponseStreamFilterSnapshot,
    Selector,
    StreamBufferState,
    StreamPositionState,
)

__all__ = ["ResponseStreamFilter"]

type _NodeID = str
type _EdgeID = str
type _Selector = Selector


@dataclass
class _Path:
    """Blocking traversal edges that must be taken before a response can stream."""

    edges: list[_EdgeID] = field(default_factory=list)

    def remove_edge(self, edge_id: _EdgeID) -> None:
        if edge_id in self.edges:
            self.edges.remove(edge_id)

    def is_empty(self) -> bool:
        return len(self.edges) == 0


@dataclass
class _ResponseSession:
    """Streaming cursor for one response node template."""

    node_id: str
    template: Template
    index: int = 0

    @classmethod
    def from_node(cls, node: NodeProtocol) -> _ResponseSession:
        get_streaming_template = getattr(node, "get_streaming_template", None)
        if not callable(get_streaming_template):
            msg = (
                "Response streaming requires get_streaming_template() on response nodes"
            )
            raise TypeError(msg)
        return cls(node_id=node.id, template=get_streaming_template())

    def is_complete(self) -> bool:
        return self.index >= len(self.template.segments)


@dataclass
class _StreamBuffers:
    """Buffered stream chunks plus per-selector read cursors."""

    events: dict[_Selector, list[NodeRunStreamChunkEvent]] = field(default_factory=dict)
    positions: dict[_Selector, int] = field(default_factory=dict)
    closed_selectors: set[_Selector] = field(default_factory=set)

    @classmethod
    def from_state(
        cls,
        *,
        buffers: Sequence[StreamBufferState],
        positions: Sequence[StreamPositionState],
        closed_selectors: Sequence[_Selector],
    ) -> _StreamBuffers:
        stream_buffers = cls(
            events={
                tuple(buffer.selector): [
                    event.model_copy(deep=True) for event in buffer.events
                ]
                for buffer in buffers
            },
            positions={
                tuple(position.selector): position.position for position in positions
            },
            closed_selectors={tuple(selector) for selector in closed_selectors},
        )
        for selector in stream_buffers.events:
            stream_buffers.positions.setdefault(selector, 0)
        return stream_buffers

    def append(
        self,
        selector: Sequence[str],
        event: NodeRunStreamChunkEvent,
    ) -> None:
        key = tuple(selector)
        if key in self.closed_selectors:
            msg = f"Stream {'.'.join(selector)} is already closed"
            raise ValueError(msg)

        if key not in self.events:
            self.events[key] = []
            self.positions[key] = 0

        self.events[key].append(event)

    def pop(
        self,
        selector: Sequence[str],
    ) -> NodeRunStreamChunkEvent | None:
        key = tuple(selector)
        if key not in self.events:
            return None

        position = self.positions.get(key, 0)
        buffer = self.events[key]
        if position >= len(buffer):
            return None

        event = buffer[position]
        self.positions[key] = position + 1
        return event

    def has_unread(self, selector: Sequence[str]) -> bool:
        key = tuple(selector)
        if key not in self.events:
            return False

        position = self.positions.get(key, 0)
        return position < len(self.events[key])

    def has_events(self, selector: Sequence[str]) -> bool:
        return tuple(selector) in self.events

    def close(self, selector: Sequence[str]) -> None:
        self.closed_selectors.add(tuple(selector))

    def is_closed(self, selector: Sequence[str]) -> bool:
        return tuple(selector) in self.closed_selectors

    def dump_buffers(self) -> list[StreamBufferState]:
        return [
            StreamBufferState(
                selector=selector,
                events=[event.model_copy(deep=True) for event in events],
            )
            for selector, events in sorted(self.events.items())
        ]

    def dump_positions(self) -> list[StreamPositionState]:
        return [
            StreamPositionState(selector=selector, position=position)
            for selector, position in sorted(self.positions.items())
        ]

    def dump_closed_selectors(self) -> list[_Selector]:
        return sorted(self.closed_selectors)


class ResponseStreamFilter:
    """Opt-in event filter that recreates legacy ordered response streaming."""

    def __init__(self, *, pass_unmatched_chunks: bool = False) -> None:
        self._pass_unmatched_chunks = pass_unmatched_chunks
        self._graph: GraphProtocol | None = None
        self._runtime_state: ReadOnlyRuntimeState | None = None
        self._file_runtime: WorkflowFileRuntimeProtocol | None = None
        self._pending_state: ResponseStreamFilterSnapshot | None = None
        self._reset_run_state()

    def _reset_run_state(self) -> None:
        self._active_session: _ResponseSession | None = None
        self._waiting_sessions: deque[_ResponseSession] = deque()
        self._stream_buffers = _StreamBuffers()
        self._response_nodes: set[str] = set()
        self._paths_maps: dict[str, list[_Path]] = {}
        self._node_execution_ids: dict[str, str] = {}
        self._response_sessions: dict[str, _ResponseSession] = {}
        self._referenced_selectors: set[_Selector] = set()

    def initialize(self, context: EngineEventFilterContext) -> None:
        with use_workflow_file_runtime(context.file_runtime):
            pending_state = self._pending_state
            self._graph = cast(GraphProtocol, context.graph)
            self._runtime_state = context.runtime_state
            self._file_runtime = context.file_runtime

            try:
                if pending_state is not None:
                    self._apply_state(pending_state)
                    return

                self._reset_run_state()
                for node in context.graph.nodes.values():
                    if node.execution_type == NodeExecutionType.RESPONSE:
                        self._register(node.id)
            except Exception:
                self._graph = None
                self._runtime_state = None
                if pending_state is None:
                    self._reset_run_state()
                raise

    def on_event(self, event: EngineEvent) -> Iterable[EngineEvent]:
        with use_workflow_file_runtime(self._file_runtime):
            return self._process_event(event)

    def _process_event(self, event: EngineEvent) -> Iterable[EngineEvent]:
        self._ensure_initialized()
        match event:
            case GraphRunStartedEvent():
                output: Iterable[EngineEvent] = [
                    event,
                    *self._activate_initial_sessions(),
                ]
            case NodeRunStartedEvent():
                self._node_execution_ids[event.node_id] = event.id
                output = [event]
            case NodeRunStreamChunkEvent():
                output = self._handle_stream_chunk(event)
            case NodeRunReasoningChunkEvent():
                output = self._handle_reasoning_chunk(event)
            case GraphEdgeTakenEvent():
                output = (
                    self._handle_edge_taken(event.edge_id)
                    if event.frame_id == ROOT_FRAME_ID
                    else []
                )
            case GraphEdgeSkippedEvent():
                output = []
            case NodeRunSucceededEvent() | NodeRunExceptionEvent():
                output = [*self._try_flush(), event]
            case _:
                output = [event]
        return output

    def flush(self) -> Iterable[EngineEvent]:
        self._ensure_initialized()
        with use_workflow_file_runtime(self._file_runtime):
            return self._try_flush()

    def dumps(self) -> str:
        if self._pending_state is not None:
            return snapshot.dumps(self._pending_state)
        self._ensure_initialized()

        state = v2.Snapshot(
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
            stream_buffers=self._stream_buffers.dump_buffers(),
            stream_positions=self._stream_buffers.dump_positions(),
            closed_streams=self._stream_buffers.dump_closed_selectors(),
        )
        return snapshot.dumps(state)

    def loads(self, data: str) -> None:
        with use_workflow_file_runtime(self._file_runtime):
            state = snapshot.loads(data)
            if self._graph is None or self._pending_state is not None:
                self._pending_state = state
                return

            self._apply_state(state)

    def _apply_state(self, state: ResponseStreamFilterSnapshot) -> None:
        state = snapshot.for_graph(state, self._bound_graph)

        response_nodes = set(state.response_nodes)
        paths_maps = {
            node_id: [_Path(edges=list(path_edges)) for path_edges in paths]
            for node_id, paths in state.paths_map.items()
        }
        node_execution_ids = dict(state.node_execution_ids)

        stream_buffers = _StreamBuffers.from_state(
            buffers=state.stream_buffers,
            positions=state.stream_positions,
            closed_selectors=state.closed_streams,
        )
        waiting_sessions = deque(
            self._session_from_state(session_state)
            for session_state in state.waiting_sessions
        )
        response_sessions = {
            session_state.node_id: self._session_from_state(session_state)
            for session_state in state.pending_sessions
        }
        active_session = (
            self._session_from_state(state.active_session)
            if state.active_session
            else None
        )

        referenced_selectors: set[_Selector] = set()
        for response_node_id in response_nodes:
            referenced_selectors.update(
                self._get_referenced_selectors(response_node_id)
            )

        self._active_session = active_session
        self._waiting_sessions = waiting_sessions
        self._stream_buffers = stream_buffers
        self._response_nodes = response_nodes
        self._paths_maps = paths_maps
        self._node_execution_ids = node_execution_ids
        self._response_sessions = response_sessions
        self._referenced_selectors = referenced_selectors
        self._pending_state = None

    def _ensure_initialized(self) -> None:
        if (
            self._graph is None
            or self._runtime_state is None
            or self._pending_state is not None
        ):
            msg = "ResponseStreamFilter must be initialized before use."
            raise RuntimeError(msg)

    @property
    def _bound_graph(self) -> GraphProtocol:
        if self._graph is None:
            msg = "ResponseStreamFilter must be initialized before use."
            raise RuntimeError(msg)
        return self._graph

    @property
    def _bound_runtime_state(self) -> ReadOnlyRuntimeState:
        if self._runtime_state is None:
            msg = "ResponseStreamFilter must be initialized before use."
            raise RuntimeError(msg)
        return self._runtime_state

    def _register(self, response_node_id: _NodeID) -> None:
        if response_node_id in self._response_nodes:
            return
        self._response_nodes.add(response_node_id)
        self._paths_maps[response_node_id] = self._build_paths_map(response_node_id)

        response_node = self._bound_graph.nodes[response_node_id]
        self._response_sessions[response_node_id] = _ResponseSession.from_node(
            response_node,
        )
        self._record_referenced_selectors(response_node_id)

    def _record_referenced_selectors(self, response_node_id: _NodeID) -> None:
        self._referenced_selectors.update(
            self._get_referenced_selectors(response_node_id)
        )

    def _get_referenced_selectors(
        self,
        response_node_id: _NodeID,
    ) -> set[_Selector]:
        response_node = self._bound_graph.nodes.get(response_node_id)
        if response_node is None:
            return set()

        response_session = _ResponseSession.from_node(response_node)
        return {
            tuple(segment.selector)
            for segment in response_session.template.segments
            if isinstance(segment, VariableSegment)
        }

    def _build_paths_map(self, response_node_id: _NodeID) -> list[_Path]:
        root_node_id = self._bound_graph.root_node.id
        if root_node_id == response_node_id:
            return [_Path()]

        variable_selectors = self._get_response_variable_selectors(response_node_id)
        all_complete_paths = self._find_all_paths(root_node_id, response_node_id)
        return [
            _Path(edges=self._get_blocking_edges(path, variable_selectors))
            for path in all_complete_paths
        ]

    def _get_response_variable_selectors(
        self,
        response_node_id: _NodeID,
    ) -> set[_Selector]:
        response_node = self._bound_graph.nodes[response_node_id]
        response_session = _ResponseSession.from_node(response_node)
        return {
            tuple(segment.selector[:2])
            for segment in response_session.template.segments
            if isinstance(segment, VariableSegment)
        }

    def _find_all_paths(
        self,
        current_node_id: _NodeID,
        target_node_id: _NodeID,
        current_path: list[_EdgeID] | None = None,
        visited: set[_NodeID] | None = None,
    ) -> list[list[_EdgeID]]:
        current_path = current_path or []
        visited = visited or set()
        if current_node_id == target_node_id:
            return [current_path.copy()]

        next_visited = {current_node_id, *visited}
        paths: list[list[_EdgeID]] = []
        for edge in self._bound_graph.get_outgoing_edges(current_node_id):
            if edge.head in next_visited:
                continue
            paths.extend(
                self._find_all_paths(
                    edge.head,
                    target_node_id,
                    [*current_path, edge.id],
                    next_visited,
                ),
            )
        return paths

    def _get_blocking_edges(
        self,
        path: list[_EdgeID],
        variable_selectors: set[_Selector],
    ) -> list[_EdgeID]:
        return [
            edge_id
            for edge_id in path
            if self._is_blocking_edge(edge_id, variable_selectors)
        ]

    def _is_blocking_edge(
        self,
        edge_id: _EdgeID,
        variable_selectors: set[_Selector],
    ) -> bool:
        edge = self._bound_graph.edges[edge_id]
        source_node = self._bound_graph.nodes[edge.tail]
        return source_node.execution_type in frozenset((
            NodeExecutionType.BRANCH,
            NodeExecutionType.CONTAINER,
            NodeExecutionType.RESPONSE,
        )) or source_node.blocks_variable_output(variable_selectors)

    def _activate_initial_sessions(self) -> list[EngineEvent]:
        events: list[EngineEvent] = []
        for response_node_id in sorted(self._response_nodes):
            paths = self._paths_maps.get(response_node_id, [])
            if any(path.is_empty() for path in paths):
                events.extend(self._active_or_queue_session(response_node_id))
        return events

    def _handle_edge_taken(self, edge_id: _EdgeID) -> list[EngineEvent]:
        events: list[EngineEvent] = []
        for response_node_id in sorted(self._response_nodes):
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

    def _active_or_queue_session(
        self,
        node_id: _NodeID,
    ) -> list[EngineEvent]:
        session = self._response_sessions.pop(node_id, None)
        if session is None:
            return []

        if self._active_session is None:
            self._active_session = session
            return self._try_flush()

        self._waiting_sessions.append(session)
        return []

    def _handle_stream_chunk(
        self,
        event: NodeRunStreamChunkEvent,
    ) -> list[EngineEvent]:
        selector_key = tuple(event.selector)
        if selector_key in self._referenced_selectors:
            self._stream_buffers.append(event.selector, event)
            if event.is_final:
                self._stream_buffers.close(event.selector)
            return self._try_flush()
        if self._pass_unmatched_chunks:
            return [event]
        return []

    def _handle_reasoning_chunk(
        self,
        event: NodeRunReasoningChunkEvent,
    ) -> list[EngineEvent]:
        if self._is_reasoning_visible(event):
            return [event]
        return []

    def _is_reasoning_visible(self, event: NodeRunReasoningChunkEvent) -> bool:
        return (
            self._has_valid_reasoning_selector(event)
            and self._has_runnable_reasoning_source(event.node_id)
            and self._is_reasoning_referenced_by_reached_session(event)
        )

    @staticmethod
    def _has_valid_reasoning_selector(event: NodeRunReasoningChunkEvent) -> bool:
        return tuple(event.selector) == (event.node_id, "reasoning_content")

    def _has_runnable_reasoning_source(self, node_id: _NodeID) -> bool:
        source_node = self._bound_graph.nodes.get(node_id)
        return bool(source_node and source_node.state != NodeState.SKIPPED)

    def _is_reasoning_referenced_by_reached_session(
        self,
        event: NodeRunReasoningChunkEvent,
    ) -> bool:
        reasoning_key = tuple(event.selector)
        companion_text_key = (event.node_id, "text")
        return any(
            self._session_references_reasoning_source(
                session,
                selector_prefixes={reasoning_key, companion_text_key},
            )
            for session in self._reached_sessions()
        )

    def _reached_sessions(self) -> tuple[_ResponseSession, ...]:
        sessions: list[_ResponseSession] = []
        if self._active_session is not None:
            sessions.append(self._active_session)
        sessions.extend(self._waiting_sessions)
        return tuple(sessions)

    @staticmethod
    def _session_references_reasoning_source(
        session: _ResponseSession,
        selector_prefixes: set[_Selector],
    ) -> bool:
        return any(
            isinstance(segment, VariableSegment)
            and tuple(segment.selector[:2]) in selector_prefixes
            for segment in session.template.segments
        )

    def _get_or_create_execution_id(self, node_id: _NodeID) -> str:
        if node_id not in self._node_execution_ids:
            self._node_execution_ids[node_id] = str(uuid4())
        return self._node_execution_ids[node_id]

    def _create_stream_chunk_event(
        self,
        node_id: _NodeID,
        execution_id: str,
        selector: Sequence[str],
        chunk: str,
        is_final: bool = False,
    ) -> NodeRunStreamChunkEvent:
        graph = self._bound_graph
        if selector and selector[0] not in graph.nodes and self._active_session:
            response_node = graph.nodes[self._active_session.node_id]
            return NodeRunStreamChunkEvent(
                id=execution_id,
                node_id=response_node.id,
                node_type=response_node.node_type,
                selector=list(selector),
                chunk=chunk,
                is_final=is_final,
            )

        node = graph.nodes[node_id]
        return NodeRunStreamChunkEvent(
            id=execution_id,
            node_id=node.id,
            node_type=node.node_type,
            selector=list(selector),
            chunk=chunk,
            is_final=is_final,
        )

    def _process_variable_segment(
        self,
        segment: VariableSegment,
    ) -> tuple[list[NodeRunStreamChunkEvent], bool]:
        events: list[NodeRunStreamChunkEvent] = []
        source_selector_prefix = segment.selector[0] if segment.selector else ""
        is_complete = False

        is_special_selector = source_selector_prefix not in self._bound_graph.nodes
        if self._active_session and is_special_selector:
            output_node_id = self._active_session.node_id
        else:
            output_node_id = source_selector_prefix
        execution_id = self._get_or_create_execution_id(output_node_id)
        has_stream_events = self._stream_buffers.has_events(segment.selector)

        while self._stream_buffers.has_unread(segment.selector):
            event = self._stream_buffers.pop(segment.selector)
            if event is None:
                continue

            if self._active_session and is_special_selector:
                response_node = self._bound_graph.nodes[self._active_session.node_id]
                events.append(
                    NodeRunStreamChunkEvent(
                        id=execution_id,
                        node_id=response_node.id,
                        node_type=response_node.node_type,
                        container_id=event.container_id,
                        selector=list(event.selector),
                        chunk=event.chunk,
                        is_final=event.is_final,
                    )
                )
            else:
                events.append(event)

        if self._stream_buffers.is_closed(segment.selector):
            is_complete = True
        elif not has_stream_events and (
            value := self._bound_runtime_state.variable_pool.get(segment.selector)
        ):
            is_last_segment = bool(
                self._active_session
                and self._active_session.index
                == len(self._active_session.template.segments) - 1,
            )
            events.append(
                self._create_stream_chunk_event(
                    node_id=output_node_id,
                    execution_id=execution_id,
                    selector=segment.selector,
                    chunk=value.markdown,
                    is_final=is_last_segment,
                ),
            )
            is_complete = True

        return events, is_complete

    def _process_text_segment(
        self,
        segment: TextSegment,
    ) -> list[NodeRunStreamChunkEvent]:
        active_session = self._active_session
        if active_session is None:
            msg = "Cannot process a text segment without an active response session."
            raise RuntimeError(msg)

        current_response_node = self._bound_graph.nodes[active_session.node_id]
        execution_id = self._get_or_create_execution_id(current_response_node.id)
        is_last_segment = (
            active_session.index == len(active_session.template.segments) - 1
        )
        return [
            self._create_stream_chunk_event(
                node_id=current_response_node.id,
                execution_id=execution_id,
                selector=self._get_text_segment_selector(current_response_node.id),
                chunk=segment.text,
                is_final=is_last_segment,
            )
        ]

    def _get_text_segment_selector(self, response_node_id: _NodeID) -> Sequence[str]:
        response_node = self._bound_graph.nodes[response_node_id]
        get_streaming_text_selector = getattr(
            response_node,
            "get_streaming_text_selector",
            None,
        )
        if callable(get_streaming_text_selector):
            selector = get_streaming_text_selector()
            return [str(part) for part in selector]
        return [response_node.id, "answer"]

    def _try_flush(self) -> list[EngineEvent]:
        if not self._active_session:
            return []

        template = self._active_session.template
        response_node_id = self._active_session.node_id
        events: list[EngineEvent] = []

        while self._active_session.index < len(template.segments):
            segment = template.segments[self._active_session.index]

            if isinstance(segment, VariableSegment):
                source_selector_prefix = segment.selector[0] if segment.selector else ""
                if source_selector_prefix in self._bound_graph.nodes:
                    source_node = self._bound_graph.nodes[source_selector_prefix]
                    if source_node.state == NodeState.SKIPPED:
                        self._active_session.index += 1
                        continue

                segment_events, is_complete = self._process_variable_segment(segment)
                events.extend(segment_events)

                if is_complete:
                    self._active_session.index += 1
                else:
                    break
            else:
                events.extend(self._process_text_segment(segment))
                self._active_session.index += 1

        if self._active_session.is_complete():
            events.extend(self._end_session(response_node_id))

        return events

    def _end_session(self, node_id: _NodeID) -> list[EngineEvent]:
        if not self._active_session or self._active_session.node_id != node_id:
            return []

        self._active_session = None
        if not self._waiting_sessions:
            return []

        self._active_session = self._waiting_sessions.popleft()
        return self._try_flush()

    def _serialize_session(
        self,
        session: _ResponseSession | None,
    ) -> ResponseSessionState | None:
        if session is None:
            return None
        return ResponseSessionState(node_id=session.node_id, index=session.index)

    def _session_from_state(
        self,
        session_state: ResponseSessionState,
    ) -> _ResponseSession:
        node = self._bound_graph.nodes.get(session_state.node_id)
        if node is None:
            msg = f"Unknown response node '{session_state.node_id}' in serialized state"
            raise ValueError(msg)

        session = _ResponseSession.from_node(node)
        session.index = session_state.index
        return session
