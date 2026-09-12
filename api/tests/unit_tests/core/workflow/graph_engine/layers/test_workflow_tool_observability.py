from collections.abc import Generator
from contextlib import AbstractContextManager
from contextvars import ContextVar
from functools import partial
from threading import Event, get_ident
from types import TracebackType
from typing import override
from unittest.mock import MagicMock

import pytest
from flask import current_app, g
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import get_current_span

from context import capture_current_context
from context.flask_app_context import capture_flask_context
from core.app.layers import execution_context_layer as module
from core.app.workflow.file_runtime import init_app
from core.app.workflow.layers.observability import ObservabilityLayer
from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
from core.workflow.workflow_entry import WorkflowEntry
from core.workflow.workflow_tool_container_handler import WorkflowToolContainerHandler
from dify_app import DifyApp
from graphon.engine import Engine
from graphon.engine.layer import Layer
from graphon.engine_events import GraphRunSucceededEvent, NodeEvent
from graphon.entities.base_node_data import BaseNodeData
from graphon.node_events.base import NodeEventPayload
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import ContainerAwaitRequest, ContainerRunResult
from graphon.runtime import RuntimeState, VariablePool
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.core.workflow.test_workflow_tool_container import (
    _outer_graph,
    _source_workflow,
    _workflow_tool_node,
)


@pytest.mark.parametrize("check", ["context_tokens", "child_parentage"])
def test_workflow_tool_tracing_survives_worker_handoff(
    check: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    tracer_provider_with_memory_exporter: TracerProvider,
    memory_span_exporter: InMemorySpanExporter,
) -> None:
    apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
    tool_started_on: list[int] = []
    tool_finished_on: list[int] = []
    completed = Event()

    class HandoffLayer(Layer):
        @override
        def node_run_context(
            self, node: Node[BaseNodeData], *, parent_execution_id: str | None = None
        ) -> AbstractContextManager[None]:
            return HandoffContext()

        @override
        def on_node_run_start(self, node: Node[BaseNodeData]) -> None:
            if node.id == "tool":
                tool_started_on.append(get_ident())

        @override
        def on_node_run_end(
            self, node: Node[BaseNodeData], error: Exception | None, result_event: NodeEvent | None = None
        ) -> None:
            if node.id == "tool":
                tool_finished_on.append(get_ident())
                completed.set()

    tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)
    with tracer.start_as_current_span("workflow") as root_span:
        captured_context = capture_current_context()

        class HandoffContext(AbstractContextManager[None]):
            @override
            def __enter__(self) -> None:
                captured_context.__enter__()

            @override
            def __exit__(
                self, exc_type: type[BaseException] | None, exc: BaseException | None, traceback: TracebackType | None
            ) -> None:
                captured_context.__exit__(exc_type, exc, traceback)
                if tool_started_on == [get_ident()] and not completed.is_set():
                    # Keep the starting worker occupied after suspension so another
                    # worker must execute the child graph and resume the Tool.
                    assert completed.wait(10), "Workflow Tool did not resume on the available worker"

        state = RuntimeState(workflow_id="outer-workflow", variable_pool=VariablePool(), start_at=1)
        tool, _, _ = _workflow_tool_node(state)
        original_resume = tool._resume_container_events

        def instrument_resume(
            *, result: ContainerRunResult
        ) -> Generator[NodeEventPayload | ContainerAwaitRequest, None, None]:
            with tracer.start_as_current_span("resume-operation"):
                yield from original_resume(result=result)

        monkeypatch.setattr(tool, "_resume_container_events", instrument_resume)
        app, workflow = _source_workflow()
        repository = MagicMock(spec=WorkflowToolSourceRepository)
        repository.get_source.return_value = WorkflowToolSource(
            app_id=app.id,
            workflow_id=workflow.id,
            graph_config=workflow.graph_dict,
            features_dict={},
            environment_variables=[],
            workflow_kind="standard",
        )
        engine = Engine(
            graph=_outer_graph(tool),
            runtime_state=state,
            workers=2,
            container_handler_factories=(partial(WorkflowToolContainerHandler, source_repository=repository),),
        )
        engine.add_layer(HandoffLayer())
        engine.add_layer(ObservabilityLayer())

        events = list(engine.run())

    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert len(tool_started_on) == len(tool_finished_on) == 1
    assert tool_started_on != tool_finished_on
    spans = memory_span_exporter.get_finished_spans()
    tool_spans = [span for span in spans if (span.attributes or {}).get("node.id") == "tool"]
    assert len(tool_spans) == 1
    tool_span = tool_spans[0]
    assert tool_span.parent == root_span.get_span_context()
    resumed_operations = [span for span in spans if span.name == "resume-operation"]
    assert len(resumed_operations) == 1
    assert resumed_operations[0].parent == tool_span.context
    if check == "context_tokens":
        assert "was created in a different Context" not in caplog.text
    else:
        children = [span for span in spans if (span.attributes or {}).get("node.id") in {"source-start", "source-end"}]
        assert len(children) == 2
        assert all(span.parent == tool_span.context for span in children)


def test_standalone_node_uses_worker_scoped_tracing_context(
    monkeypatch: pytest.MonkeyPatch,
    tracer_provider_with_memory_exporter: TracerProvider,
    memory_span_exporter: InMemorySpanExporter,
) -> None:
    apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
    tool, _, _ = _workflow_tool_node()
    node = _outer_graph(tool).root_node
    tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)
    with tracer.start_as_current_span("standalone") as parent:
        events = list(WorkflowEntry._run_node_with_layers(node, tenant_id="tenant"))
        assert get_current_span() is parent

    assert isinstance(events[-1], NodeEvent)
    assert events[-1].node_run_result.status == "succeeded"
    node_spans = [span for span in memory_span_exporter.get_finished_spans() if span.name == node.title]
    assert len(node_spans) == 1
    assert node_spans[0].parent == parent.get_span_context()


def test_interleaved_snippets_restore_caller_flask_context(
    monkeypatch: pytest.MonkeyPatch,
    tracer_provider_with_memory_exporter: TracerProvider,
    memory_span_exporter: InMemorySpanExporter,
) -> None:
    apply_config_overrides(monkeypatch, ENABLE_OTEL=True)
    monkeypatch.setattr(module, "capture_current_context", capture_flask_context)
    request_id: ContextVar[str] = ContextVar("snippet_request_id")
    tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)
    parents = []
    snippets = []
    observed = []
    for name in ("first", "second"):
        app = DifyApp(name)
        init_app(app)
        with app.app_context(), tracer.start_as_current_span(name) as parent:
            parents.append(parent.get_span_context())
            g._login_user = name
            request_id.set(name)
            tool, _, _ = _workflow_tool_node()
            node = _outer_graph(tool).root_node

            def run_node() -> Generator[MagicMock, None, None]:
                observed.append((current_app.name, g._login_user, request_id.get()))
                yield MagicMock()
                observed.append((current_app.name, g._login_user, request_id.get()))
                yield MagicMock()

            monkeypatch.setattr(node, "run", run_node)
            snippets.append(WorkflowEntry._run_node_with_layers(node, tenant_id="tenant"))

    caller = DifyApp("caller")
    init_app(caller)
    with caller.app_context(), tracer.start_as_current_span("caller") as caller_span:
        g._login_user = "caller"
        request_id.set("caller")
        for _ in range(2):
            for snippet in snippets:
                next(snippet)
                assert current_app == caller
                assert g._login_user == request_id.get() == "caller"
                assert get_current_span() is caller_span
        for snippet in snippets:
            snippet.close()
            assert current_app == caller
            assert g._login_user == request_id.get() == "caller"
            assert get_current_span() is caller_span

    assert observed == [(name, name, name) for name in ("first", "second", "first", "second")]
    spans = memory_span_exporter.get_finished_spans()
    node_spans = [span for span in spans if (span.attributes or {}).get("node.id") == "outer-start"]
    assert len(node_spans) == 2
    assert [span.parent for span in node_spans] == parents
