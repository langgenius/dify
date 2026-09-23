from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from typing import override

import pytest
from flask import current_app, g

from context.flask_app_context import capture_flask_context
from core.app.layers import execution_context_layer as module
from core.app.layers.execution_context_layer import ExecutionContextLayer
from core.app.workflow.file_runtime import create_dify_workflow_file_runtime, init_app
from core.workflow.node_factory import DifyNodeFactory
from dify_app import DifyApp
from graphon.engine import Engine
from graphon.engine.layer import Layer
from graphon.engine_events import GraphRunSucceededEvent
from graphon.entities.base_node_data import BaseNodeData
from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
from graphon.graph import Graph
from graphon.nodes.base.node import Node
from graphon.runtime import RuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


def test_host_context_preserves_each_engine_file_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    app = DifyApp("execution-context")
    init_app(app)
    monkeypatch.setattr(module, "capture_current_context", capture_flask_context)
    request_id: ContextVar[str] = ContextVar("request_id")
    caller_runtime = create_dify_workflow_file_runtime()

    def build_engine(request: str) -> tuple[Engine, list[str]]:
        runtime = create_dify_workflow_file_runtime()
        with app.app_context():
            g._login_user = request
            request_id.set(request)
            host = ExecutionContextLayer()
        checked_nodes: list[str] = []

        def check_context() -> None:
            assert current_app == app
            assert g._login_user == request
            assert request_id.get() == request
            assert peek_workflow_file_runtime() is runtime

        class CheckNodeContext(Layer):
            @override
            def on_node_run_start(self, node: Node[BaseNodeData]) -> None:
                check_context()
                checked_nodes.append(node.id)

        graph_config: dict[str, object] = {
            "nodes": [
                {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [{"source": "start", "target": "end", "sourceHandle": "source"}],
        }
        state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
        engine = Engine(
            graph=Graph.init(
                graph_config=graph_config,
                root_node_id="start",
                node_factory=DifyNodeFactory(
                    init_params=build_test_graph_init_params(workflow_id="workflow", graph_config=graph_config),
                    runtime_state=state,
                ),
            ),
            runtime_state=state,
            workers=2,
            file_runtime=runtime,
        )
        engine.add_layer(host)
        engine.add_layer(CheckNodeContext())
        return engine, checked_nodes

    engines = [build_engine("first"), build_engine("second")]

    def run_engine(item: tuple[Engine, list[str]]) -> None:
        engine, checked_nodes = item
        with use_workflow_file_runtime(caller_runtime):
            for event in engine.run():
                assert peek_workflow_file_runtime() is caller_runtime
            assert isinstance(event, GraphRunSucceededEvent)
            assert set(checked_nodes) == {"start", "end"}
            assert peek_workflow_file_runtime() is caller_runtime

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run_engine, engines))
