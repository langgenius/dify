"""Tests for IM inbox OpenTelemetry instrument semantics."""

from __future__ import annotations

from collections.abc import Mapping

import opentelemetry.metrics
import pytest

from configs import dify_config
from services.human_input_v2.im_message_inbox.telemetry import OpenTelemetryIMInboxMetrics


class _RecordingCounter:
    def add(self, amount: int, attributes: Mapping[str, str]) -> None:
        pass


class _RecordingGauge:
    updates: list[tuple[int | float, Mapping[str, str] | None]]

    def __init__(self) -> None:
        self.updates = []

    def set(self, amount: int | float, attributes: Mapping[str, str] | None = None) -> None:
        self.updates.append((amount, attributes))


class _RecordingHistogram:
    def record(self, amount: int | float, attributes: Mapping[str, str] | None = None) -> None:
        pass


class _RecordingMeter:
    gauges: dict[str, _RecordingGauge]
    histogram_names: list[str]

    def __init__(self) -> None:
        self.gauges = {}
        self.histogram_names = []

    def create_counter(self, name: str, *, description: str, unit: str) -> _RecordingCounter:
        del name, description, unit
        return _RecordingCounter()

    def create_gauge(self, name: str, *, description: str, unit: str) -> _RecordingGauge:
        del description, unit
        gauge = _RecordingGauge()
        self.gauges[name] = gauge
        return gauge

    def create_histogram(self, name: str, *, description: str, unit: str) -> _RecordingHistogram:
        del description, unit
        self.histogram_names.append(name)
        return _RecordingHistogram()


def test_backlog_snapshots_use_current_value_gauges(monkeypatch: pytest.MonkeyPatch) -> None:
    meter = _RecordingMeter()

    def get_meter(_name: str, *, version: str) -> _RecordingMeter:
        del version
        return meter

    monkeypatch.setattr(dify_config, "ENABLE_OTEL", True)
    monkeypatch.setattr(opentelemetry.metrics, "get_meter", get_meter)

    metrics = OpenTelemetryIMInboxMetrics()

    assert set(meter.gauges) == {
        "im_message_inbox_backlog_records",
        "im_message_inbox_oldest_pending_age_seconds",
    }
    assert meter.histogram_names == []

    metrics.record_backlog(status="pending", count=7, oldest_age_seconds=12.5)
    metrics.record_backlog(status="processing", count=3, oldest_age_seconds=None)
    metrics.record_backlog(status="pending", count=0, oldest_age_seconds=None)

    assert meter.gauges["im_message_inbox_backlog_records"].updates == [
        (7, {"status": "pending"}),
        (3, {"status": "processing"}),
        (0, {"status": "pending"}),
    ]
    assert meter.gauges["im_message_inbox_oldest_pending_age_seconds"].updates == [(12.5, None), (0, None)]
