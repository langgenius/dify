from __future__ import annotations

from types import SimpleNamespace

from core.app.workflow.layers.observability import ObservabilityLayer
from dify_graph.enums import BuiltinNodeTypes


class TestObservabilityLayerExtras:
    def test_init_tracer_enabled_sets_tracer(self, monkeypatch):
        tracer = object()
        monkeypatch.setattr("core.app.workflow.layers.observability.dify_config.ENABLE_OTEL", True)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)
        monkeypatch.setattr("core.app.workflow.layers.observability.get_tracer", lambda _: tracer)

        layer = ObservabilityLayer()

        assert layer._is_disabled is False
        assert layer._tracer is tracer

    def test_init_tracer_disables_when_get_tracer_fails(self, monkeypatch, caplog):
        monkeypatch.setattr("core.app.workflow.layers.observability.dify_config.ENABLE_OTEL", True)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)

        def _raise(*_args, **_kwargs):
            raise RuntimeError("tracer init failed")

        monkeypatch.setattr("core.app.workflow.layers.observability.get_tracer", _raise)

        layer = ObservabilityLayer()

        assert layer._is_disabled is True
        assert layer._tracer is None
        assert "Failed to get OpenTelemetry tracer" in caplog.text

    def test_init_tracer_disables_when_otel_disabled(self, monkeypatch):
        monkeypatch.setattr("core.app.workflow.layers.observability.dify_config.ENABLE_OTEL", False)
        monkeypatch.setattr("core.app.workflow.layers.observability.is_instrument_flag_enabled", lambda: False)

        layer = ObservabilityLayer()

        assert layer._is_disabled is True

    def test_get_parser_uses_registry_when_node_type_matches(self):
        layer = ObservabilityLayer()

        parser = layer._get_parser(SimpleNamespace(node_type=BuiltinNodeTypes.TOOL))

        assert parser is layer._parsers[BuiltinNodeTypes.TOOL]

    def test_get_parser_defaults_when_node_type_missing(self):
        layer = ObservabilityLayer()

        parser = layer._get_parser(SimpleNamespace(node_type=None))

        assert parser is layer._default_parser

    def test_on_graph_start_clears_contexts(self):
        layer = ObservabilityLayer()
        layer._node_contexts["exec"] = SimpleNamespace(span=object(), token="token")

        layer.on_graph_start()

        assert layer._node_contexts == {}

    def test_on_event_is_noop(self):
        layer = ObservabilityLayer()

        layer.on_event(object())

    def test_on_graph_end_clears_unfinished_contexts(self, caplog):
        layer = ObservabilityLayer()
        layer._node_contexts["exec"] = SimpleNamespace(span=object(), token="token")

        layer.on_graph_end(error=None)

        assert layer._node_contexts == {}
        assert "node spans were not properly ended" in caplog.text

    def test_on_node_run_start_skips_without_execution_id(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False
        layer._tracer = None

        layer.on_node_run_start(SimpleNamespace(execution_id=None, title="node", id="node"))

        assert layer._node_contexts == {}

    def test_on_node_run_start_skips_when_disabled(self):
        layer = ObservabilityLayer()
        layer._is_disabled = True
        layer._tracer = SimpleNamespace(start_span=lambda *_args, **_kwargs: object())

        layer.on_node_run_start(SimpleNamespace(execution_id="exec", title="node", id="node"))

        assert layer._node_contexts == {}

    def test_on_node_run_start_skips_when_execution_id_missing_even_with_tracer(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False
        calls: list[str] = []
        layer._tracer = SimpleNamespace(start_span=lambda *_args, **_kwargs: calls.append("called"))

        layer.on_node_run_start(SimpleNamespace(execution_id=None, title="node", id="node"))

        assert calls == []

    def test_on_node_run_start_logs_warning_when_span_creation_fails(self, caplog):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        def _raise(*_args, **_kwargs):
            raise RuntimeError("start failed")

        layer._tracer = SimpleNamespace(start_span=_raise)

        layer.on_node_run_start(SimpleNamespace(execution_id="exec", title="node", id="node"))

        assert "Failed to create OpenTelemetry span for node" in caplog.text

    def test_on_node_run_end_without_context_noop(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        layer.on_node_run_end(SimpleNamespace(execution_id="missing", id="node"), error=None)

        assert layer._node_contexts == {}

    def test_on_node_run_end_skips_when_disabled(self):
        layer = ObservabilityLayer()
        layer._is_disabled = True
        layer._node_contexts["exec"] = SimpleNamespace(span=object(), token="token")

        layer.on_node_run_end(SimpleNamespace(execution_id="exec", id="node"), error=None)

        assert "exec" in layer._node_contexts

    def test_on_node_run_end_skips_without_execution_id(self):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        layer.on_node_run_end(SimpleNamespace(execution_id=None, id="node"), error=None)

        assert layer._node_contexts == {}

    def test_on_node_run_end_calls_span_end(self, monkeypatch):
        layer = ObservabilityLayer()
        layer._is_disabled = False
        ended: list[str] = []

        class _Parser:
            def parse(self, **_kwargs):
                return None

        span = SimpleNamespace(end=lambda: ended.append("ended"))
        layer._default_parser = _Parser()
        layer._node_contexts["exec"] = SimpleNamespace(span=span, token="token")

        monkeypatch.setattr("core.app.workflow.layers.observability.context_api.detach", lambda _token: None)

        node = SimpleNamespace(execution_id="exec", title="Node", id="node", node_type=None)
        layer.on_node_run_end(node, error=None)

        assert ended == ["ended"]
        assert "exec" not in layer._node_contexts

    def test_on_node_run_end_logs_detach_failure(self, monkeypatch, caplog):
        layer = ObservabilityLayer()
        layer._is_disabled = False

        class _Parser:
            def parse(self, **_kwargs):
                return None

        layer._default_parser = _Parser()
        layer._node_contexts["exec"] = SimpleNamespace(span=SimpleNamespace(end=lambda: None), token="bad-token")

        def _raise(*_args, **_kwargs):
            raise RuntimeError("detach failed")

        monkeypatch.setattr("core.app.workflow.layers.observability.context_api.detach", _raise)

        node = SimpleNamespace(execution_id="exec", title="Node", id="node", node_type=None)
        layer.on_node_run_end(node, error=None)

        assert "Failed to detach OpenTelemetry token" in caplog.text
        assert "exec" not in layer._node_contexts

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
