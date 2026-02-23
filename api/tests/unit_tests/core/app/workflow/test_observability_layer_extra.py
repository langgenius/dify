from __future__ import annotations

from types import SimpleNamespace

from core.app.workflow.layers.observability import ObservabilityLayer


class TestObservabilityLayerExtras:
    def test_init_tracer_disables_when_otel_disabled(self, monkeypatch):
        monkeypatch.setattr("core.app.workflow.layers.observability.dify_config.ENABLE_OTEL", False)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)

        layer = ObservabilityLayer()

        assert layer._is_disabled is True

    def test_get_parser_defaults_when_node_type_missing(self):
        layer = ObservabilityLayer()

        parser = layer._get_parser(SimpleNamespace(node_type=None))

        assert parser is layer._default_parser

    def test_on_node_run_start_skips_without_execution_id(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False
        layer._tracer = None

        layer.on_node_run_start(SimpleNamespace(execution_id=None, title="node", id="node"))

        assert layer._node_contexts == {}

    def test_on_node_run_end_without_context_noop(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        layer.on_node_run_end(SimpleNamespace(execution_id="missing", id="node"), error=None)

        assert layer._node_contexts == {}

    def test_on_node_run_start_and_end_creates_span(self, monkeypatch):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        span = SimpleNamespace(end=lambda: None)
        tracer = SimpleNamespace(start_span=lambda *args, **kwargs: span)

        monkeypatch.setattr("core.app.workflow.layers.observability.context_api.get_current", lambda: object())
        monkeypatch.setattr("core.app.workflow.layers.observability.set_span_in_context", lambda s: object())
        monkeypatch.setattr("core.app.workflow.layers.observability.context_api.attach", lambda ctx: "token")
        monkeypatch.setattr("core.app.workflow.layers.observability.context_api.detach", lambda token: None)

        layer._tracer = tracer

        node = SimpleNamespace(execution_id="exec", title="Node", id="node", node_type=None)

        layer.on_node_run_start(node)
        assert "exec" in layer._node_contexts

        layer.on_node_run_end(node, error=None)
        assert "exec" not in layer._node_contexts
