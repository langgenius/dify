"""Collect canvas path facts from the actual Native Test engine across resumes."""

import logging
from collections.abc import Mapping
from dataclasses import asdict, replace
from typing import override

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphEdgeTakenEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.graph.scoping import resolve_container_id
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeTestScope
from runtime_contracts.builder.native.canvas_path import NativeCanvasEdge, NativeCanvasNodeStatus, NativeCanvasPath
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.progress_bus import publish_native_change

logger = logging.getLogger(__name__)
_PATH = TypeAdapter(NativeCanvasPath)
type EdgeKey = tuple[str | None, str, str, str]


def read_canvas_path(value: dict | None, run_id: str | None) -> NativeCanvasPath | None:
    """Read only a valid snapshot for the caller's already authorized native Run."""
    if value is None or run_id is None:
        return None
    try:
        path = _PATH.validate_python(value)
    except ValidationError:
        return None
    return path if path.native_run_id == run_id else None


def _edge_from_graph(config: object) -> NativeCanvasEdge | None:
    """Project edge identity from the executed DSL, without retaining node data."""
    if not isinstance(config, Mapping):
        return None
    edge_id, source, target = config.get("id"), config.get("source"), config.get("target")
    source_handle, target_handle = config.get("sourceHandle") or "source", config.get("targetHandle") or "target"
    if (
        not isinstance(source, str)
        or not isinstance(target, str)
        or not isinstance(source_handle, str)
        or not isinstance(target_handle, str)
    ):
        return None
    return NativeCanvasEdge(edge_id if isinstance(edge_id, str) else None, source, target, source_handle, target_handle)


class NativeCanvasPathLayer(Layer):
    """Observe the pinned graph of one scoped native attempt, without granting execution authority.

    The request owns one bounded snapshot (at most one row per graph edge in the
    JSON projection). Every attempt seeds from that snapshot. A revoked or
    superseded attempt cannot overwrite the last committed path.
    """

    def __init__(
        self,
        *,
        sessions: sessionmaker,
        ref: NativeTestContextRef,
        actor: Actor,
        app_id: str,
        workflow_id: str,
        run_id: str,
        graph: Mapping[str, object],
    ) -> None:
        super().__init__()
        self._sessions, self._run_id = sessions, run_id
        self._request = select(DifyBuilderExecutionRequest).where(
            DifyBuilderExecutionRequest.id == ref.request_id,
            DifyBuilderExecutionRequest.context_digest == ref.context_digest,
            DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
            DifyBuilderExecutionRequest.actor_id == actor.account_id,
            DifyBuilderExecutionRequest.app_id == app_id,
            DifyBuilderExecutionRequest.workflow_id == workflow_id,
            DifyBuilderExecutionRequest.state.in_(("running", "waiting")),
        )
        self._scope = select(NativeTestScope).where(
            NativeTestScope.request_id == ref.request_id, NativeTestScope.tenant_id == actor.tenant_id
        )
        nodes, edges = graph.get("nodes"), graph.get("edges")
        nodes_by_id = (
            {node["id"]: node for node in nodes if isinstance(node, Mapping) and isinstance(node.get("id"), str)}
            if isinstance(nodes, list)
            else {}
        )
        self._node_owners = {
            node_id: resolve_container_id(node, nodes_by_id=nodes_by_id) for node_id, node in nodes_by_id.items()
        }
        candidates: dict[EdgeKey, list[NativeCanvasEdge]] = {}
        for edge in filter(None, map(_edge_from_graph, edges if isinstance(edges, list) else ())):
            candidates.setdefault((edge.edge_id, edge.source, edge.target, edge.source_handle), []).append(edge)
        self._graph_edges = {key: values[0] for key, values in candidates.items() if len(values) == 1}
        self._generation: int | None = None
        self._snapshot: NativeCanvasPath | None = None
        self._taken: dict[NativeCanvasEdge, None] = {}
        self._statuses: dict[str, NativeCanvasNodeStatus] = {}

    def _matches_run(self, request: DifyBuilderExecutionRequest | None) -> bool:
        """Require the known launch binding and any acknowledged native Run to agree."""
        return bool(
            request is not None
            and request.context.get("native_run_id") == self._run_id
            and request.native_run_id in (None, self._run_id)
        )

    @override
    def on_graph_start(self) -> None:
        """Seed the same Run's path before processing a new execution segment."""
        try:
            with self._sessions() as sql:
                request, scope = sql.scalar(self._request), sql.scalar(self._scope)
                if request is None or not self._matches_run(request) or scope is None or scope.cancelled:
                    return
                self._generation = scope.generation
                self._snapshot = read_canvas_path(request.canvas_path, self._run_id)
        except SQLAlchemyError:
            logger.warning("Builder canvas path could not be restored")
            return
        if self._snapshot is not None:
            for edge in self._snapshot.edges:
                self._taken[replace(edge, source_status=None, target_status=None)] = None
                if edge.source_status is not None:
                    self._statuses[edge.source] = edge.source_status
                if edge.target_status is not None:
                    self._statuses[edge.target] = edge.target_status

    @override
    def on_event(self, event: EngineEvent) -> None:
        """Advance the display path only from native traversal and node events."""
        if self._generation is None:
            return
        match event:
            case GraphEdgeTakenEvent():
                route = (event.source_node_id, event.target_node_id, event.source_handle or "source")
                edge = self._graph_edges.get((event.edge_id, *route)) or self._graph_edges.get((None, *route))
                if (
                    edge is None
                    or self._node_owners.get(edge.source) != event.container_id
                    or self._node_owners.get(edge.target) != event.container_id
                ):
                    return
                self._taken[edge] = None
            case NodeRunRetryEvent():
                self._mark_node(event, "retry")
            case NodeRunStartedEvent():
                self._mark_node(event, "running")
            case NodeRunPauseRequestedEvent():
                self._mark_node(event, "paused")
            case NodeRunSucceededEvent():
                self._mark_node(event, "succeeded")
            case NodeRunFailedEvent():
                self._mark_node(event, "failed")
            case NodeRunExceptionEvent():
                self._mark_node(event, "exception")
            case GraphRunAbortedEvent():
                self._settle_active("stopped")
            case GraphRunFailedEvent():
                self._settle_active("failed")
            case GraphRunPausedEvent():
                self._settle_active("paused")
            case _:
                return
        self._persist(allow_cancelled=isinstance(event, GraphRunAbortedEvent))

    def _mark_node(
        self,
        event: NodeRunStartedEvent
        | NodeRunPauseRequestedEvent
        | NodeRunSucceededEvent
        | NodeRunFailedEvent
        | NodeRunExceptionEvent,
        status: NativeCanvasNodeStatus,
    ) -> None:
        """Accept an endpoint status only from the owning graph container."""
        if self._node_owners.get(event.node_id) == event.container_id:
            self._statuses[event.node_id] = status

    def _settle_active(self, status: NativeCanvasNodeStatus) -> None:
        """Apply the graph lifecycle outcome to endpoints still actively running."""
        self._statuses = {
            node_id: status if current in ("running", "retry") else current
            for node_id, current in self._statuses.items()
        }

    def _persist(self, *, allow_cancelled: bool) -> None:
        """Publish after committing new display facts for the current request generation."""
        previous = self._snapshot
        edges = tuple(
            replace(edge, source_status=self._statuses.get(edge.source), target_status=self._statuses.get(edge.target))
            for edge in self._taken
        )
        if previous is not None and edges == previous.edges:
            return
        snapshot = NativeCanvasPath(self._run_id, (previous.revision if previous else 0) + 1, edges)
        try:
            with self._sessions.begin() as sql:
                request = sql.scalar(self._request.with_for_update())
                scope = sql.scalar(self._scope)
                if (
                    request is None
                    or not self._matches_run(request)
                    or scope is None
                    or scope.generation != self._generation
                    or (scope.cancelled and not allow_cancelled)
                    or read_canvas_path(request.canvas_path, self._run_id) != previous
                ):
                    return
                request.canvas_path = asdict(snapshot)
                session_id = request.session_id
        except SQLAlchemyError:
            logger.warning("Builder canvas path could not be saved")
            return
        self._snapshot = snapshot
        publish_native_change(session_id)
