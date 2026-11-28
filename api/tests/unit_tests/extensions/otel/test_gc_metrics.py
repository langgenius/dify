"""Verify exported GC telemetry using the real OTel collector, reader and SDK."""

import gc
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass

import pytest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    Gauge,
    Histogram,
    InMemoryMetricReader,
    Metric,
    NumberDataPoint,
    Sum,
)

from configs import dify_config
from extensions.otel.gc_metrics import init_gc_metrics
from libs.gc_freeze import freeze_startup_objects


@dataclass
class Metrics:
    stop: Callable[[], None]
    memory: InMemoryMetricReader
    closed: bool = False

    def collect(self) -> dict[str, Metric]:
        data = self.memory.get_metrics_data()
        assert data is not None
        return {m.name: m for r in data.resource_metrics for s in r.scope_metrics for m in s.metrics}

    def numbers(self, name: str) -> Sequence[NumberDataPoint]:
        data = self.collect()[name].data
        assert isinstance(data, (Gauge, Sum))
        return data.data_points

    def close(self) -> None:
        if not self.closed:
            self.stop()
            self.closed = True


@pytest.fixture
def telemetry(monkeypatch: pytest.MonkeyPatch) -> Iterator[Metrics]:
    enabled = gc.isenabled()
    gc.disable()
    monkeypatch.setattr(gc, "get_count", lambda: (17, 3, 1))
    memory = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[memory], shutdown_on_exit=False)
    stop = init_gc_metrics(provider)
    metrics = Metrics(stop, memory)
    try:
        yield metrics
    finally:
        metrics.close()
        provider.shutdown()
        if enabled:
            gc.enable()


def test_exports_standard_gc_counters_without_heap_walks(telemetry: Metrics, monkeypatch: pytest.MonkeyPatch) -> None:
    def unexpected_scan(*_: object) -> None:
        pytest.fail("Metric collection must not walk either GC heap")

    monkeypatch.setattr(gc, "get_objects", unexpected_scan)
    monkeypatch.setattr(gc, "get_freeze_count", unexpected_scan)
    monkeypatch.setattr(gc, "get_count", lambda: (17, 3, 1))
    stats = gc.get_stats()
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
    assert [p.value for p in telemetry.numbers("cpython.gc.count")] == [17, 3, 1]
    assert [p.value for p in telemetry.numbers("cpython.gc.threshold")] == list(gc.get_threshold())
    assert telemetry.numbers("cpython.gc.enabled")[0].value == 0
    assert telemetry.numbers("dify.gc.duration_samples_dropped")[0].value == 0


def test_records_durations_on_the_existing_collection_cycle(
    telemetry: Metrics, monkeypatch: pytest.MonkeyPatch
) -> None:
    ticks = iter((100_000_000, 350_000_000))
    monkeypatch.setattr("extensions.otel.gc_metrics.perf_counter_ns", lambda: next(ticks))
    gc.collect(2)
    histogram = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    point = histogram.data_points[0]
    assert point.attributes == {"generation": "2", "phase": "runtime"}
    assert point.count == 1
    assert point.sum == 0.25
    telemetry.close()
    gc.collect(2)
    stopped = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(stopped, Histogram)
    assert stopped.data_points[0].count == 1


def test_startup_count_is_cached_and_startup_duration_is_separate(
    telemetry: Metrics, monkeypatch: pytest.MonkeyPatch
) -> None:
    reads = 0

    def frozen_count() -> int:
        nonlocal reads
        reads += 1
        return 12345

    monkeypatch.setattr(dify_config, "GC_FREEZE_AFTER_STARTUP", True)
    monkeypatch.setattr(gc, "freeze", lambda: None)
    monkeypatch.setattr(gc, "get_freeze_count", frozen_count)
    freeze_startup_objects()
    gc.collect(2)
    histogram = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    assert len(histogram.data_points) == 2
    for phase in ("startup", "runtime"):
        point = next(p for p in histogram.data_points if p.attributes == {"generation": "2", "phase": phase})
        assert point.count == 1
    assert telemetry.numbers("dify.gc.startup_frozen_objects")[0].value == 12345
    telemetry.collect()
    assert reads == 1


def test_disabled_freeze_still_records_runtime_gc(telemetry: Metrics, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "GC_FREEZE_AFTER_STARTUP", False)
    freeze_startup_objects()
    gc.collect(2)
    assert telemetry.numbers("dify.gc.startup_frozen_objects")[0].value == 0
    histogram = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    assert len(histogram.data_points) == 1
    assert histogram.data_points[0].attributes == {"generation": "2", "phase": "runtime"}


def test_overflow_is_reported_without_losing_native_collection_counts(telemetry: Metrics) -> None:
    before = gc.get_stats()[0]["collections"]
    for _ in range(10_000):
        gc.collect(0)
    exported = telemetry.collect()
    histogram = exported["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    dropped = telemetry.numbers("dify.gc.duration_samples_dropped")[0].value
    assert dropped > 0
    assert histogram.data_points[0].count + dropped == 10_000
    assert telemetry.numbers("cpython.gc.collections")[0].value - before == 10_000


def test_young_generation_overflow_keeps_full_collection_durations(telemetry: Metrics) -> None:
    gc.collect(2)
    for _ in range(4100):
        gc.collect(0)
    histogram = telemetry.collect()["dify.gc.duration"].data
    assert isinstance(histogram, Histogram)
    full = [p for p in histogram.data_points if p.attributes == {"generation": "2", "phase": "runtime"}]
    assert len(full) == 1
    assert full[0].count == 1
    dropped = {
        str((p.attributes or {}).get("generation")): p.value
        for p in telemetry.numbers("dify.gc.duration_samples_dropped")
    }
    assert dropped["2"] == 0
    assert dropped["0"] > 0
