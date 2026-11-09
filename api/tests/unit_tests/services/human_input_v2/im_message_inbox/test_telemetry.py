"""Tests for payload-free IM callback metrics."""

from __future__ import annotations

from collections.abc import Mapping

import opentelemetry.metrics
import pytest

from configs import dify_config
from core.human_input_v2.entities import IMProvider
from services.human_input_v2.im_message_inbox.telemetry import IMInboxMetricKind, OpenTelemetryIMInboxMetrics


class _RecordingCounter:
    calls: list[tuple[int, Mapping[str, str]]]

    def __init__(self) -> None:
        self.calls = []

    def add(self, amount: int, attributes: Mapping[str, str]) -> None:
        self.calls.append((amount, attributes))


class _RecordingMeter:
    def __init__(self) -> None:
        self.counter = _RecordingCounter()

    def create_counter(self, name: str, *, description: str, unit: str) -> _RecordingCounter:
        assert name == "im_message_inbox_events_total"
        del description, unit
        return self.counter


def test_callback_metrics_use_low_cardinality_dimensions(monkeypatch: pytest.MonkeyPatch) -> None:
    meter = _RecordingMeter()

    def get_meter(_name: str, *, version: str) -> _RecordingMeter:
        del version
        return meter

    monkeypatch.setattr(dify_config, "ENABLE_OTEL", True)
    monkeypatch.setattr(opentelemetry.metrics, "get_meter", get_meter)
    metrics = OpenTelemetryIMInboxMetrics()

    metrics.record(IMInboxMetricKind.ACCEPTANCE, provider=IMProvider.FEISHU, outcome="new")

    assert meter.counter.calls == [(1, {"kind": "acceptance", "provider": "feishu", "outcome": "new"})]
