"""Worker-local Socket.IO load metrics without persistence or per-message network I/O.

Lifecycle updates run on the Socket.IO gevent hub and never yield. Observable callbacks
only read immutable numeric snapshots, including when the SDK collects on a native thread.
Room counts describe local membership, not globally distinct rooms or distinct people.
No room, socket, tenant, user, payload, or exception values become metric attributes.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from functools import wraps
from time import perf_counter
from typing import Literal, NamedTuple, Protocol, runtime_checkable

from flask import Flask
from opentelemetry.metrics import CallbackOptions, Meter, Observation, get_meter

from configs import dify_config

logger = logging.getLogger(__name__)

type SocketEvent = Literal["connect", "user_connect", "disconnect", "collaboration_event", "graph_event"]
type Outcome = Literal["success", "rejected", "error"]

_EVENT_TYPES = frozenset(
    {
        "mouse_move",
        "vars_and_features_update",
        "sync_request",
        "workflow_update",
        "comments_update",
        "node_panel_presence",
        "graph_view_state",
        "graph_resync_request",
    }
)
_SIZE_RANGES = ("1", "2-5", "6-10", "11-20", "21+")
_WORKER_ATTRIBUTES = {"aggregation_scope": "worker"}
_EXTENSION_KEY = "workflow_collaboration_metrics"


class _SocketManager(Protocol):
    def is_connected(self, sid: str, namespace: str) -> bool: ...


@runtime_checkable
class _SocketIO(Protocol):
    @property
    def app(self) -> Flask: ...

    @property
    def manager(self) -> _SocketManager: ...

    def rooms(self, sid: str, namespace: str) -> list[str]: ...


class _Snapshot(NamedTuple):
    connections: int
    rooms: int
    size_ranges: tuple[int, ...]


def _size_range(size: int) -> str:
    """Given a positive local room size, return one bounded attribute value without I/O."""
    if size == 1:
        return "1"
    if size <= 5:
        return "2-5"
    if size <= 10:
        return "6-10"
    if size <= 20:
        return "11-20"
    return "21+"


class WorkflowCollaborationMetrics:
    """Own one worker's instruments and an idempotent mirror of accepted socket membership.

    Writers must run in Socket.IO handlers on the gevent hub; they perform no I/O or
    yielding operations. SDK collection never traverses the mutable membership maps.
    Unknown/late joins cannot recreate disconnected sessions, and duplicate lifecycle
    notifications cannot inflate counts. Instrument failures are isolated by the decorator.
    """

    def __init__(self, meter: Meter | None = None) -> None:
        """Register instruments with the supplied/default meter and start with zero load."""
        self._connections: dict[str, frozenset[str]] = {}
        self._room_sizes: dict[str, int] = {}
        self._size_counts = dict.fromkeys(_SIZE_RANGES, 0)
        self._snapshot = _Snapshot(0, 0, (0,) * len(_SIZE_RANGES))
        meter = meter if meter is not None else get_meter("dify.collaboration")
        meter.create_observable_gauge(
            "dify.collaboration.connections",
            callbacks=(self._observe_connections,),
            description="Authenticated Socket.IO sessions connected to this worker; not distinct users",
            unit="{connection}",
        )
        meter.create_observable_gauge(
            "dify.collaboration.rooms",
            callbacks=(self._observe_rooms,),
            description="Workflow rooms with local members; summing workers does not give globally distinct rooms",
            unit="{room}",
        )
        meter.create_observable_gauge(
            "dify.collaboration.room_sessions",
            callbacks=(self._observe_room_sessions,),
            description="Current local room count by local session-count range; not a join-weighted histogram",
            unit="{room}",
        )
        self._events = meter.create_counter(
            "dify.collaboration.events", description="Completed Socket.IO handlers by event and outcome", unit="{event}"
        )
        self._duration = meter.create_histogram(
            "dify.collaboration.event_duration",
            description="Socket.IO handler wall time, including dependency waits; not peer delivery or client ACK time",
            unit="s",
            explicit_bucket_boundaries_advisory=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30),
        )

    def _observe_connections(self, _: CallbackOptions) -> Iterable[Observation]:
        """Return a numeric snapshot for any collector thread without accessing live sockets."""
        return (Observation(self._snapshot.connections, attributes=_WORKER_ATTRIBUTES),)

    def _observe_rooms(self, _: CallbackOptions) -> Iterable[Observation]:
        """Return the local room snapshot, including zero after the last member leaves."""
        return (Observation(self._snapshot.rooms, attributes=_WORKER_ATTRIBUTES),)

    def _observe_room_sessions(self, _: CallbackOptions) -> Iterable[Observation]:
        """Return all fixed range counts from one snapshot without exposing room identifiers."""
        snapshot = self._snapshot
        return tuple(
            Observation(count, attributes={**_WORKER_ATTRIBUTES, "size_range": size_range})
            for size_range, count in zip(_SIZE_RANGES, snapshot.size_ranges, strict=True)
        )

    def _publish_snapshot(self) -> None:
        """After a lifecycle update, atomically replace the collector's immutable numeric view."""
        self._snapshot = _Snapshot(len(self._connections), len(self._room_sizes), tuple(self._size_counts.values()))

    def _change_room_size(self, room: str, delta: Literal[-1, 1]) -> None:
        """Apply one known member addition/removal and keep current room buckets consistent."""
        previous = self._room_sizes.get(room, 0)
        if previous:
            self._size_counts[_size_range(previous)] -= 1
        current = previous + delta
        if current:
            self._room_sizes[room] = current
            self._size_counts[_size_range(current)] += 1
        else:
            del self._room_sizes[room]

    def connected(self, sid: str) -> None:
        """Register a live, authenticated SID once; a duplicate preserves existing memberships."""
        if sid not in self._connections:
            self._connections[sid] = frozenset()
            self._publish_snapshot()

    def update_rooms(self, sid: str, rooms: Sequence[str]) -> None:
        """Mirror actual rooms for a registered SID; ignore late joins and exclude its private room."""
        previous = self._connections.get(sid)
        if previous is None:
            return
        current = frozenset(room for room in rooms if room != sid)
        for room in previous - current:
            self._change_room_size(room, -1)
        for room in current - previous:
            self._change_room_size(room, 1)
        self._connections[sid] = current
        self._publish_snapshot()

    def disconnected(self, sid: str) -> None:
        """Remove a SID and all local memberships, tolerating duplicate or rejected disconnects."""
        previous = self._connections.pop(sid, None)
        if previous is not None:
            for room in previous:
                self._change_room_size(room, -1)
            self._publish_snapshot()

    def record_event(self, event: SocketEvent, event_type: str, outcome: Outcome, duration_seconds: float) -> None:
        """Record one completed handler with bounded labels; propagate SDK failures to the isolation boundary."""
        bounded_type = event_type if event_type in _EVENT_TYPES else "other"
        attributes = {
            "event": event,
            "event_type": bounded_type if event == "collaboration_event" else "none",
            "outcome": outcome,
        }
        self._events.add(1, attributes=attributes)
        self._duration.record(duration_seconds, attributes=attributes)


def init_workflow_collaboration_metrics(app: Flask) -> None:
    """Bind metrics during enabled OTel startup, after the provider and before serving events.

    The application owns one instance; repeated startup calls preserve its state.
    Registration failure leaves instrumentation absent and business handlers usable.
    """
    if _EXTENSION_KEY not in app.extensions:
        try:
            app.extensions[_EXTENSION_KEY] = WorkflowCollaborationMetrics()
        except Exception:
            logger.exception("Failed to initialize workflow collaboration metrics")


def _outcome(result: object) -> Outcome:
    """Classify existing handler results without modifying their body, status, or identity."""
    if result is False:
        return "rejected"
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[1], int):
        if result[1] >= 500:
            return "error"
        if result[1] >= 400:
            return "rejected"
    return "success"


def observe_workflow_event[**P, R](
    event: SocketEvent, socketio: _SocketIO
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Observe an existing synchronous Socket.IO handler without changing returns or exceptions.

    The caller supplies the event and Socket.IO server bound to its initialized app.
    Disabled or unavailable instrumentation calls the handler directly. Otherwise capture
    membership in the handler thread, even when a join partially succeeds or Redis cleanup
    fails, without additional Redis/SQL queries. Telemetry failures never alter authentication,
    room membership, ACK payloads, or the handler's exception.
    """

    def decorate(handler: Callable[P, R]) -> Callable[P, R]:
        """Preserve the handler signature and metadata while observing its completion."""

        @wraps(handler)
        def observed(*args: P.args, **kwargs: P.kwargs) -> R:
            """Run the original handler once and isolate all metric-side failures in finally."""
            if not dify_config.ENABLE_OTEL:
                return handler(*args, **kwargs)
            metrics = socketio.app.extensions.get(_EXTENSION_KEY)
            if not isinstance(metrics, WorkflowCollaborationMetrics):
                return handler(*args, **kwargs)

            started = perf_counter()
            outcome: Outcome = "error"
            try:
                result = handler(*args, **kwargs)
                outcome = _outcome(result)
                return result
            finally:
                duration = perf_counter() - started
                try:
                    sid = args[0] if args else kwargs.get("sid")
                    try:
                        if isinstance(sid, str):
                            if event == "connect" and outcome == "success" and socketio.manager.is_connected(sid, "/"):
                                metrics.connected(sid)
                            elif event == "user_connect":
                                metrics.update_rooms(sid, socketio.rooms(sid, "/"))
                            elif event == "disconnect":
                                metrics.disconnected(sid)
                    finally:
                        data = args[1] if len(args) > 1 else kwargs.get("data")
                        event_type = data.get("type") if isinstance(data, Mapping) else None
                        metrics.record_event(
                            event, event_type if isinstance(event_type, str) else "other", outcome, duration
                        )
                except Exception:
                    logger.warning("Failed to record workflow collaboration metrics", exc_info=True)

        return observed

    return decorate
