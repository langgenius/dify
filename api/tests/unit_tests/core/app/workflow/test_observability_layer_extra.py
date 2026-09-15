from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.workflow.layers.observability import ObservabilityLayer
from tests.unit_tests.config_override import apply_config_overrides


class TestObservabilityLayerExtras:
    def test_init_tracer_enabled_sets_tracer(self, monkeypatch: pytest.MonkeyPatch):
        tracer = object()
        apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)
        monkeypatch.setattr("core.app.workflow.layers.observability.get_tracer", lambda _: tracer)

        layer = ObservabilityLayer()

        assert layer._is_disabled is False
        assert layer._tracer is tracer

    def test_init_tracer_disables_when_get_tracer_fails(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)

        def _raise(*_args, **_kwargs):
            raise RuntimeError("tracer init failed")

        monkeypatch.setattr("core.app.workflow.layers.observability.get_tracer", _raise)

        layer = ObservabilityLayer()

        assert layer._is_disabled is True
        assert layer._tracer is None
        assert "Failed to get OpenTelemetry tracer" in caplog.text

    def test_init_tracer_disables_when_otel_disabled(self, monkeypatch: pytest.MonkeyPatch):
        apply_config_overrides(monkeypatch, ENABLE_OTEL=False)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)

        layer = ObservabilityLayer()

        assert layer._is_disabled is True

    def test_node_run_context_skips_without_execution_id(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False
        calls: list[str] = []
        layer._tracer = SimpleNamespace(start_span=lambda *_args, **_kwargs: calls.append("called"))

        with layer.node_run_context(SimpleNamespace(execution_id=None, title="node", id="node")):
            assert calls == []

        assert calls == []

    def test_node_runs_when_span_creation_fails(self, caplog: pytest.LogCaptureFixture):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        def _raise(*_args, **_kwargs):
            raise RuntimeError("start failed")

        layer._tracer = SimpleNamespace(start_span=_raise)

        node_executed = False
        with layer.node_run_context(SimpleNamespace(execution_id="exec", title="node", id="node")):
            node_executed = True

        assert node_executed
        assert "start failed" in caplog.text
