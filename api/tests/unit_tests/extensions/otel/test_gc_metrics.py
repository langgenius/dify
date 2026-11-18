"""Verify exported GC telemetry using real CPython collections and the OTel SDK."""

import gc
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from time import perf_counter

import pytest
from opentelemetry.instrumentation.system_metrics import SystemMetricsInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    Gauge,
    Histogram,
    InMemoryMetricReader,
    Metric,
    NumberDataPoint,
    Sum,
)

from extensions.otel.gc_metrics import init_gc_metrics


@dataclass
class _Metrics:
    stop: Callable[[], None]
    memory: InMemoryMetricReader

    def collect(self) -> dict[str, Metric]:
        """Collect the registered instruments through the SDK's normal collection path."""
        data = self.memory.get_metrics_data()
        assert data is not None
        return {m.name: m for r in data.resource_metrics for s in r.scope_metrics for m in s.metrics}

    def numbers(self, name: str) -> Sequence[NumberDataPoint]:
        """Return numeric points for an exported gauge or sum, failing on other types."""
        data = self.collect()[name].data
        assert isinstance(data, (Gauge, Sum))
        return data.data_points


@pytest.fixture
def telemetry() -> Iterator[_Metrics]:
    """Observe explicit collections without automatic GC, restoring process state on exit."""
    enabled = gc.isenabled()
    gc.disable()
    memory = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[memory], shutdown_on_exit=False)
    stop = init_gc_metrics(provider)
    try:
        yield _Metrics(stop, memory)
    finally:
        stop()
        provider.shutdown()
        if enabled:
            gc.enable()


def test_exports_standard_gc_counters_without_heap_walks(telemetry: _Metrics, monkeypatch: pytest.MonkeyPatch) -> None:
    """Export the real interpreter statistics without triggering collections or heap scans."""
    stats = gc.get_stats()

    def unexpected_scan(*_: object) -> None:
        pytest.fail("Metric collection must not collect or walk either GC heap")

    monkeypatch.setattr(gc, "collect", unexpected_scan)
    monkeypatch.setattr(gc, "get_objects", unexpected_scan)
    monkeypatch.setattr(gc, "get_freeze_count", unexpected_scan)
    for field, name in [
        ("collections", "cpython.gc.collections"),
        ("collected", "cpython.gc.collected_objects"),
        ("uncollectable", "cpython.gc.uncollectable_objects"),
    ]:
        points = telemetry.numbers(name)
        assert len(points) == 3
        for generation, point in enumerate(points):
            assert point.attributes is not None
            assert point.attributes["cpython.gc.generation"] == generation
            assert point.value == stats[generation][field]
    counts = telemetry.numbers("cpython.gc.count")
    assert [p.attributes for p in counts] == [{"generation": str(i)} for i in range(3)]
    assert all(p.value >= 0 for p in counts)
    assert [p.value for p in counts[1:]] == list(gc.get_count())[1:]
    assert [p.value for p in telemetry.numbers("cpython.gc.threshold")] == list(gc.get_threshold())
    assert telemetry.numbers("cpython.gc.enabled")[0].value == 0
    assert [p.value for p in telemetry.numbers("dify.gc.duration_samples_dropped")] == [0, 0, 0]


def test_records_durations_on_the_existing_collection_cycle(telemetry: _Metrics) -> None:
    """One real collection produces one positive duration with seconds as its unit."""
    started = perf_counter()
    gc.collect(2)
    elapsed = perf_counter() - started
    metric = telemetry.collect()["dify.gc.duration"]
    assert metric.unit == "s"
    assert isinstance(metric.data, Histogram)
    point = metric.data.data_points[0]
    assert point.attributes == {"generation": "2"}
    assert point.count == 1
    assert 0 < point.sum <= elapsed
    # An empty collection cycle must not publish the same sample again.
    repeated = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(repeated, Histogram)
    assert repeated.data_points[0].count == 1


def test_close_preserves_pending_samples_for_the_final_flush(telemetry: _Metrics) -> None:
    """Repeated cleanup stops new observations while pending durations remain exportable."""
    gc.collect(2)
    telemetry.stop()
    telemetry.stop()
    gc.collect(2)
    histogram = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    assert histogram.data_points[0].count == 1


def test_reports_automatic_gc_enabled(telemetry: _Metrics) -> None:
    """The enabled gauge follows the interpreter's current automatic collection setting."""
    gc.enable()
    assert telemetry.numbers("cpython.gc.enabled")[0].value == 1


def test_overflow_is_reported_without_losing_native_collection_counts(telemetry: _Metrics) -> None:
    """Retained plus dropped durations account for every collection across export cycles."""
    before = gc.get_stats()[0]["collections"]
    for cycle in range(1, 3):
        for _ in range(10_000):
            gc.collect(0)
        exported = telemetry.collect()
        histogram = exported["dify.gc.duration"].data
        assert isinstance(histogram, Histogram)
        dropped = telemetry.numbers("dify.gc.duration_samples_dropped")[0].value
        assert dropped > 0
        assert histogram.data_points[0].count + dropped == cycle * 10_000
        assert telemetry.numbers("cpython.gc.collections")[0].value - before == cycle * 10_000


def test_young_generation_overflow_keeps_full_collection_durations(telemetry: _Metrics) -> None:
    """Young-generation traffic cannot evict a pending full-collection duration."""
    gc.collect(2)
    gc.collect(1)
    for _ in range(4100):
        gc.collect(0)
    histogram = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    points = {str((p.attributes or {})["generation"]): p for p in histogram.data_points}
    assert points["2"].count == 1
    assert points["1"].count == 1
    assert points["0"].count <= 4096
    dropped = {
        str((p.attributes or {})["generation"]): p.value for p in telemetry.numbers("dify.gc.duration_samples_dropped")
    }
    assert dropped["2"] == 0
    assert dropped["1"] == 0
    assert points["0"].count + dropped["0"] == 4100


def test_preserves_existing_system_metrics_instrumentation() -> None:
    """Cleanup must leave a SystemMetricsInstrumentor owned by another caller installed."""
    memory = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[memory], shutdown_on_exit=False)
    native = SystemMetricsInstrumentor(config={"cpython.gc.collections": None})
    native.instrument(meter_provider=provider)
    stop = init_gc_metrics(provider)
    try:
        stop()
        assert native.is_instrumented_by_opentelemetry
        assert memory.get_metrics_data() is not None
    finally:
        stop()
        native.uninstrument()
        provider.shutdown()
