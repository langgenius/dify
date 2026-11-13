"""Exercise worker-local collaboration metrics with real SDK collection and room membership."""

from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, get_ident
from typing import Never

import pytest
import socketio
from flask import Flask
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Gauge, Histogram, InMemoryMetricReader, Metric, Sum

from extensions.otel import workflow_collaboration as instrumentation

SIZE_RANGES = ("1", "2-5", "6-10", "11-20", "21+")
type ObservedMetrics = tuple[instrumentation.WorkflowCollaborationMetrics, InMemoryMetricReader]


@pytest.fixture
def metrics_app() -> Flask:
    """Create a real app with isolated extension ownership and no external services."""
    return Flask(__name__)


@pytest.fixture
def observed_metrics(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    metrics_app: Flask,
) -> Iterator[ObservedMetrics]:
    """Initialize app-owned instruments with a real SDK meter and isolate global configuration."""
    config_overrides(ENABLE_OTEL=True)
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    monkeypatch.setattr(instrumentation, "get_meter", provider.get_meter)
    instrumentation.init_workflow_collaboration_metrics(metrics_app)
    metrics = metrics_app.extensions["workflow_collaboration_metrics"]
    assert isinstance(metrics, instrumentation.WorkflowCollaborationMetrics)
    yield metrics, reader
    provider.shutdown()


@pytest.fixture
def socket_server(metrics_app: Flask, monkeypatch: pytest.MonkeyPatch) -> socketio.Server:
    """Attach the real app to a network-free server as the application factory does."""
    server = socketio.Server(async_mode="threading")
    monkeypatch.setattr(server, "app", metrics_app, raising=False)
    return server


def _metrics(reader: InMemoryMetricReader) -> dict[str, Metric]:
    """Collect actual SDK data, requiring a successful observable callback collection."""
    data = reader.get_metrics_data()
    assert data is not None
    return {
        metric.name: metric
        for resource in data.resource_metrics
        for scope in resource.scope_metrics
        for metric in scope.metrics
    }


def _assert_population(reader: InMemoryMetricReader, connections: int, rooms: int, sizes: dict[str, int]) -> None:
    """Require exact worker-scope labels and all fixed buckets, including zeroes."""
    collected = _metrics(reader)
    for name, expected in (("connections", connections), ("rooms", rooms)):
        data = collected[f"dify.collaboration.{name}"].data
        assert isinstance(data, Gauge)
        assert len(data.data_points) == 1
        point = data.data_points[0]
        assert point.attributes == {"aggregation_scope": "worker"}
        assert point.value == expected

    distribution = collected["dify.collaboration.room_sessions"].data
    assert isinstance(distribution, Gauge)
    assert len(distribution.data_points) == len(SIZE_RANGES)
    actual: dict[str, int | float] = {}
    for point in distribution.data_points:
        assert point.attributes is not None
        assert set(point.attributes) == {"aggregation_scope", "size_range"}
        assert point.attributes["aggregation_scope"] == "worker"
        size_range = point.attributes["size_range"]
        assert isinstance(size_range, str)
        actual[size_range] = point.value
    assert actual == {size_range: sizes.get(size_range, 0) for size_range in SIZE_RANGES}


def _assert_event(reader: InMemoryMetricReader, event: str, event_type: str, outcome: str) -> None:
    """Require one matching counter and duration sample without payload-derived labels."""
    collected = _metrics(reader)
    expected = {"event": event, "event_type": event_type, "outcome": outcome}
    events = collected["dify.collaboration.events"].data
    durations = collected["dify.collaboration.event_duration"].data
    assert isinstance(events, Sum)
    assert isinstance(durations, Histogram)
    assert len(events.data_points) == len(durations.data_points) == 1
    assert events.data_points[0].attributes == expected
    assert events.data_points[0].value == 1
    assert durations.data_points[0].attributes == expected
    assert durations.data_points[0].count == 1
    assert durations.data_points[0].sum >= 0


def test_empty_worker_emits_all_zero_gauges(observed_metrics: ObservedMetrics) -> None:
    """An unused worker still exports zero-valued populations and every size bucket."""
    _, reader = observed_metrics
    _assert_population(reader, connections=0, rooms=0, sizes={})


def test_duplicate_connections_and_joins_do_not_inflate_population(observed_metrics: ObservedMetrics) -> None:
    """Repeated lifecycle notifications preserve unique local SID and room membership."""
    metrics, reader = observed_metrics
    metrics.connected("sid-a")
    metrics.connected("sid-a")
    metrics.update_rooms("sid-a", ["sid-a", "workflow-a", "workflow-a"])
    metrics.update_rooms("sid-a", ["sid-a", "workflow-a"])
    _assert_population(reader, connections=1, rooms=1, sizes={"1": 1})

    metrics.connected("sid-b")
    metrics.update_rooms("sid-b", ["sid-b", "workflow-a"])
    _assert_population(reader, connections=2, rooms=1, sizes={"2-5": 1})


def test_room_snapshot_replaces_membership_and_disconnect_clears_it(observed_metrics: ObservedMetrics) -> None:
    """Multiple actual rooms are counted until removed; late joins cannot resurrect a SID."""
    metrics, reader = observed_metrics
    metrics.connected("sid-a")
    metrics.connected("sid-b")
    metrics.update_rooms("sid-a", ["sid-a", "workflow-a", "workflow-b"])
    metrics.update_rooms("sid-b", ["sid-b", "workflow-a"])
    _assert_population(reader, connections=2, rooms=2, sizes={"1": 1, "2-5": 1})

    metrics.update_rooms("sid-a", ["sid-a", "workflow-b"])
    _assert_population(reader, connections=2, rooms=2, sizes={"1": 2})
    metrics.disconnected("sid-a")
    metrics.disconnected("sid-a")
    metrics.update_rooms("sid-a", ["workflow-b"])
    _assert_population(reader, connections=1, rooms=1, sizes={"1": 1})

    metrics.disconnected("sid-b")
    metrics.update_rooms("unknown-sid", ["new-workflow"])
    _assert_population(reader, connections=0, rooms=0, sizes={})


@pytest.mark.parametrize(
    ("members", "before", "after"),
    [
        (1, "1", None),
        (2, "2-5", "1"),
        (5, "2-5", "2-5"),
        (6, "6-10", "2-5"),
        (10, "6-10", "6-10"),
        (11, "11-20", "6-10"),
        (20, "11-20", "11-20"),
        (21, "21+", "11-20"),
    ],
)
def test_room_distribution_crosses_fixed_bucket_boundaries(
    observed_metrics: ObservedMetrics, members: int, before: str, after: str | None
) -> None:
    """Room-size buckets describe current rooms and move immediately on member departure."""
    metrics, reader = observed_metrics
    for index in range(members):
        sid = f"sid-{index}"
        metrics.connected(sid)
        metrics.update_rooms(sid, [sid, "workflow-a"])
    _assert_population(reader, connections=members, rooms=1, sizes={before: 1})

    metrics.disconnected("sid-0")
    _assert_population(reader, connections=members - 1, rooms=int(members > 1), sizes={after: 1} if after else {})


def test_record_event_exports_seconds_and_matching_counter(observed_metrics: ObservedMetrics) -> None:
    """Counter and histogram retain the same bounded dimensions and seconds unit."""
    metrics, reader = observed_metrics
    metrics.record_event("graph_event", "none", "success", 0.025)
    _assert_event(reader, "graph_event", "none", "success")
    duration = _metrics(reader)["dify.collaboration.event_duration"]
    assert duration.unit == "s"
    assert isinstance(duration.data, Histogram)
    assert duration.data.data_points[0].sum == pytest.approx(0.025)


@pytest.mark.parametrize(
    ("result", "outcome"),
    [
        (None, "success"),
        (True, "success"),
        (False, "rejected"),
        (0, "success"),
        ({"status": 500}, "success"),
        (({"msg": "ok"}, 200), "success"),
        (({"msg": "denied"}, 403), "rejected"),
        (({"msg": "failed"}, 503), "error"),
        (("ack", "opaque"), "success"),
    ],
)
def test_event_outcome_preserves_exact_handler_return(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server, result: object, outcome: str
) -> None:
    """Only explicit rejection or HTTP-like status tuples classify a normal return as failure."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    _, reader = observed_metrics

    @instrumentation.observe_workflow_event("graph_event", socket_server)
    def handler(_sid: str, _data: object) -> object:
        return result

    assert handler("sid-a", b"graph-data") is result
    assert handler.__name__ == "handler"
    _assert_event(reader, "graph_event", "none", outcome)


@pytest.mark.parametrize(
    ("payload", "expected_type"),
    [
        ({"type": "mouse_move"}, "mouse_move"),
        ({"type": "workflow_update"}, "workflow_update"),
        ({"type": "untrusted-user-specific-event"}, "other"),
        ({}, "other"),
        ({"type": ["mouse_move"]}, "other"),
        ({"type": None}, "other"),
        (None, "other"),
        (b"data", "other"),
    ],
)
def test_event_types_are_bounded_without_changing_payload(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server, payload: object, expected_type: str
) -> None:
    """Unknown and malformed payloads stay handler-owned and cannot add metric series."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    _, reader = observed_metrics

    @instrumentation.observe_workflow_event("collaboration_event", socket_server)
    def handler(_sid: str, data: object) -> object:
        return data

    assert handler("sid-a", payload) is payload
    _assert_event(reader, "collaboration_event", expected_type, "success")


def test_event_exception_is_recorded_and_reraised_unchanged(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server
) -> None:
    """Instrumentation preserves the original exception instance while reporting failure."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    _, reader = observed_metrics
    failure = ValueError("handler failed")

    @instrumentation.observe_workflow_event("collaboration_event", socket_server)
    def handler(_sid: str, _data: object) -> Never:
        raise failure

    with pytest.raises(ValueError, match="handler failed") as caught:
        handler("sid-a", {"type": "mouse_move"})
    assert caught.value is failure
    _assert_event(reader, "collaboration_event", "mouse_move", "error")


@pytest.mark.parametrize("accepted", [True, False])
def test_connect_counts_only_authenticated_sockets(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server, accepted: bool
) -> None:
    """A provisional Socket.IO room exists before authentication, but rejected SIDs do not count."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    _, reader = observed_metrics
    sid = socket_server.manager.connect("engine-sid", "/")
    assert isinstance(sid, str)

    @instrumentation.observe_workflow_event("connect", socket_server)
    def handler(_sid: str, _environ: object, _auth: object) -> bool:
        return accepted

    assert handler(sid, {}, None) is accepted
    _assert_population(reader, connections=int(accepted), rooms=0, sizes={})
    _assert_event(reader, "connect", "none", "success" if accepted else "rejected")


def test_connect_completed_after_disconnect_does_not_restore_socket(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server
) -> None:
    """A successful handler cannot reintroduce a SID that disconnected during authentication."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    _, reader = observed_metrics
    sid = socket_server.manager.connect("engine-sid", "/")
    assert isinstance(sid, str)

    @instrumentation.observe_workflow_event("connect", socket_server)
    def handler(sid: str, _environ: object, _auth: object) -> bool:
        socket_server.manager.disconnect(sid, "/")
        return True

    assert handler(sid, {}, None) is True
    _assert_population(reader, connections=0, rooms=0, sizes={})
    _assert_event(reader, "connect", "none", "success")


def test_partial_join_failure_reflects_real_membership(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server
) -> None:
    """An exception after enter_room retains actual local membership and the original failure."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    metrics, reader = observed_metrics
    sid = socket_server.manager.connect("engine-sid", "/")
    assert isinstance(sid, str)
    metrics.connected(sid)
    failure = RuntimeError("broadcast failed after join")

    @instrumentation.observe_workflow_event("user_connect", socket_server)
    def handler(sid: str, data: dict[str, str]) -> Never:
        socket_server.enter_room(sid, data["workflow_id"])
        raise failure

    with pytest.raises(RuntimeError) as caught:
        handler(sid, {"workflow_id": "workflow-a"})
    assert caught.value is failure
    _assert_population(reader, connections=1, rooms=1, sizes={"1": 1})
    _assert_event(reader, "user_connect", "none", "error")


def test_disconnect_failure_still_removes_all_local_membership(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server
) -> None:
    """Population cleanup does not depend on the service's Redis cleanup succeeding."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    metrics, reader = observed_metrics
    sid = socket_server.manager.connect("engine-sid", "/")
    assert isinstance(sid, str)
    metrics.connected(sid)
    socket_server.enter_room(sid, "workflow-a")
    metrics.update_rooms(sid, socket_server.rooms(sid))
    socket_server.manager.pre_disconnect(sid, "/")
    failure = RuntimeError("service cleanup failed")

    @instrumentation.observe_workflow_event("disconnect", socket_server)
    def handler(_sid: str) -> Never:
        raise failure

    with pytest.raises(RuntimeError) as caught:
        handler(sid)
    assert caught.value is failure
    _assert_population(reader, connections=0, rooms=0, sizes={})
    _assert_event(reader, "disconnect", "none", "error")


def test_room_lookup_failure_does_not_hide_return_or_event(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A metrics-only membership lookup failure cannot change an ACK or suppress event accounting."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    metrics, reader = observed_metrics
    sid = socket_server.manager.connect("engine-sid", "/")
    assert isinstance(sid, str)
    metrics.connected(sid)
    result = {"msg": "connected"}

    def unavailable_rooms(*_args: object, **_kwargs: object) -> Never:
        raise RuntimeError("room lookup failed")

    monkeypatch.setattr(socket_server, "rooms", unavailable_rooms)

    @instrumentation.observe_workflow_event("user_connect", socket_server)
    def handler(_sid: str, _data: object) -> dict[str, str]:
        return result

    assert handler(sid, {}) is result
    _assert_event(reader, "user_connect", "none", "success")


def test_collecting_gauges_never_reads_live_socket_manager(
    observed_metrics: ObservedMetrics, socket_server: socketio.Server, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SDK collection consumes the published snapshot even when every room accessor is unavailable."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    metrics, reader = observed_metrics
    sid = socket_server.manager.connect("engine-sid", "/")
    assert isinstance(sid, str)
    metrics.connected(sid)
    socket_server.enter_room(sid, "workflow-a")

    @instrumentation.observe_workflow_event("user_connect", socket_server)
    def handler(_sid: str, _data: object) -> dict[str, str]:
        return {"msg": "connected"}

    handler(sid, {})

    def forbidden_access(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("observable callbacks must not touch live manager state")

    monkeypatch.setattr(socket_server, "rooms", forbidden_access)
    monkeypatch.setattr(socket_server.manager, "get_rooms", forbidden_access)
    monkeypatch.setattr(socket_server.manager, "get_participants", forbidden_access)
    _assert_population(reader, connections=1, rooms=1, sizes={"1": 1})


def test_native_thread_collection_uses_complete_numeric_snapshots(observed_metrics: ObservedMetrics) -> None:
    """Native SDK collection tolerates handler-side churn without traversing mutable membership."""
    metrics, reader = observed_metrics
    ready = Barrier(2)
    handler_thread = get_ident()

    def collect() -> int:
        ready.wait(timeout=5)
        for _ in range(50):
            distribution = _metrics(reader)["dify.collaboration.room_sessions"].data
            assert isinstance(distribution, Gauge)
            assert len(distribution.data_points) == len(SIZE_RANGES)
            counts = [point.value for point in distribution.data_points]
            assert all(count >= 0 for count in counts)
            assert sum(counts) in (0, 1)
        return get_ident()

    with ThreadPoolExecutor(max_workers=1) as executor:
        collection = executor.submit(collect)
        ready.wait(timeout=5)
        for index in range(1000):
            sid = f"sid-{index}"
            metrics.connected(sid)
            metrics.update_rooms(sid, [sid, "workflow-a"])
            metrics.disconnected(sid)
        assert collection.result(timeout=10) != handler_thread
    _assert_population(reader, connections=0, rooms=0, sizes={})


@pytest.mark.parametrize("handler_fails", [False, True])
def test_sdk_failure_never_changes_handler_result_or_exception(
    observed_metrics: ObservedMetrics,
    socket_server: socketio.Server,
    monkeypatch: pytest.MonkeyPatch,
    handler_fails: bool,
) -> None:
    """An instrument failure stays isolated from the successful ACK or original business exception."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    metrics, _ = observed_metrics
    result = {"msg": "received"}
    handler_failure = ValueError("original handler failure")

    def unavailable_sdk(*_args: object, **_kwargs: object) -> Never:
        raise RuntimeError("metric SDK failure")

    monkeypatch.setattr(metrics._events, "add", unavailable_sdk)

    @instrumentation.observe_workflow_event("graph_event", socket_server)
    def handler(_sid: str, _data: object) -> dict[str, str]:
        if handler_fails:
            raise handler_failure
        return result

    if handler_fails:
        with pytest.raises(ValueError, match="original handler failure") as caught:
            handler("sid-a", b"graph-data")
        assert caught.value is handler_failure
    else:
        assert handler("sid-a", b"graph-data") is result


def test_startup_instance_is_shared_and_repeated_initialization_preserves_state(
    observed_metrics: ObservedMetrics,
    metrics_app: Flask,
    socket_server: socketio.Server,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Handlers share startup-owned state; repeated initialization neither registers nor resets instruments."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    assert isinstance(socket_server.manager, socketio.Manager)
    metrics, reader = observed_metrics
    registration_attempts: list[object] = []

    def forbidden_registration(*args: object, **_kwargs: object) -> Never:
        registration_attempts.extend(args)
        raise AssertionError("event handling must use the initialized app instance")

    monkeypatch.setattr(instrumentation, "get_meter", forbidden_registration)

    @instrumentation.observe_workflow_event("connect", socket_server)
    def connected(_sid: str, _environ: object, _auth: object) -> bool:
        return True

    @instrumentation.observe_workflow_event("user_connect", socket_server)
    def joined(sid: str, _data: object) -> dict[str, str]:
        socket_server.enter_room(sid, "workflow-a")
        return {"msg": "connected"}

    for index in range(2):
        sid = socket_server.manager.connect(f"engine-{index}", "/")
        assert isinstance(sid, str)
        assert connected(sid, {}, None) is True
        assert joined(sid, {}) == {"msg": "connected"}
        instrumentation.init_workflow_collaboration_metrics(metrics_app)
        assert metrics_app.extensions["workflow_collaboration_metrics"] is metrics

    assert registration_attempts == []
    _assert_population(reader, connections=2, rooms=1, sizes={"2-5": 1})
    events = _metrics(reader)["dify.collaboration.events"].data
    assert isinstance(events, Sum)
    assert len(events.data_points) == 2
    assert all(point.value == 2 for point in events.data_points)


@pytest.mark.parametrize("initialized", [False, True])
@pytest.mark.parametrize("handler_fails", [False, True])
def test_disabled_metrics_bypass_all_instrumentation_with_or_without_app_instance(
    observed_metrics: ObservedMetrics,
    metrics_app: Flask,
    socket_server: socketio.Server,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    initialized: bool,
    handler_fails: bool,
) -> None:
    """Disabled instrumentation preserves business behavior without timing, app lookup, membership, or SDK access."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    metrics, reader = observed_metrics
    if not initialized:
        metrics_app.extensions.pop("workflow_collaboration_metrics")
    accesses: list[str] = []
    result = {"msg": "connected"}
    failure = ValueError("business failure while metrics disabled")

    def forbidden_access(*_args: object, **_kwargs: object) -> Never:
        accesses.append("instrumentation")
        raise AssertionError("disabled metrics must not access instrumentation")

    monkeypatch.setattr(instrumentation, "perf_counter", forbidden_access)
    monkeypatch.setattr(instrumentation, "get_meter", forbidden_access)
    monkeypatch.setattr(type(socket_server), "app", property(forbidden_access), raising=False)
    monkeypatch.setattr(socket_server, "rooms", forbidden_access)
    monkeypatch.setattr(metrics._events, "add", forbidden_access)

    @instrumentation.observe_workflow_event("user_connect", socket_server)
    def handler(_sid: str, _data: object) -> dict[str, str]:
        if handler_fails:
            raise failure
        return result

    config_overrides(ENABLE_OTEL=False)
    if handler_fails:
        with pytest.raises(ValueError, match="business failure while metrics disabled") as caught:
            handler("sid-a", {})
        assert caught.value is failure
    else:
        assert handler("sid-a", {}) is result

    assert accesses == []
    _assert_population(reader, connections=0, rooms=0, sizes={})
    assert "dify.collaboration.events" not in _metrics(reader)


@pytest.mark.parametrize("initialization_fails", [False, True])
@pytest.mark.parametrize("handler_fails", [False, True])
def test_enabled_metrics_without_initialized_extension_leave_business_behavior_unchanged(
    metrics_app: Flask,
    socket_server: socketio.Server,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    initialization_fails: bool,
    handler_fails: bool,
) -> None:
    """Missing or failed startup instrumentation never registers lazily, times, or replaces handler results."""
    assert isinstance(socket_server, instrumentation._SocketIO)
    config_overrides(ENABLE_OTEL=True)
    registration_attempts: list[str] = []
    accesses: list[str] = []
    result = {"msg": "connected"}
    failure = ValueError("business failure without metrics instance")

    def unavailable_meter(*_args: object, **_kwargs: object) -> Never:
        registration_attempts.append("get_meter")
        raise RuntimeError("SDK initialization failed")

    def forbidden_access(*_args: object, **_kwargs: object) -> Never:
        accesses.append("handler instrumentation")
        raise AssertionError("missing instance must not trigger event instrumentation")

    monkeypatch.setattr(instrumentation, "get_meter", unavailable_meter)
    if initialization_fails:
        instrumentation.init_workflow_collaboration_metrics(metrics_app)
    assert "workflow_collaboration_metrics" not in metrics_app.extensions

    monkeypatch.setattr(instrumentation, "perf_counter", forbidden_access)
    monkeypatch.setattr(socket_server, "rooms", forbidden_access)

    @instrumentation.observe_workflow_event("user_connect", socket_server)
    def handler(_sid: str, _data: object) -> dict[str, str]:
        if handler_fails:
            raise failure
        return result

    if handler_fails:
        with pytest.raises(ValueError, match="business failure without metrics instance") as caught:
            handler("sid-a", {})
        assert caught.value is failure
    else:
        assert handler("sid-a", {}) is result

    assert accesses == []
    assert registration_attempts == (["get_meter"] if initialization_fails else [])
    assert "workflow_collaboration_metrics" not in metrics_app.extensions
